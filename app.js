import bodyParser from 'body-parser';
import { app } from 'mu';
import { v4 as uuid } from 'uuid';
import { BASES as b } from './env';
import { NAMESPACES as ns } from './env';
import { Lock } from 'async-await-mutex-lock';
import * as ts from './lib/taskSubject';
import * as tsk from './lib/task';
import * as env from './env';
import * as mas from '@lblod/mu-auth-sudo';
import * as rst from 'rdf-string-ttl';
import * as N3 from 'n3';
const { namedNode, literal } = N3.DataFactory;

const LOCK = new Lock();

app.use(
  bodyParser.json({
    type: function (req) {
      return /^application\/json/.test(req.get('content-type'));
    },
    limit: '50mb',
    extended: true,
  })
);

app.get('/', function (req, res) {
  res.send('Hello from harvesting-singleton-jobs-service');
});

app.post('/delta', async function (req, res) {
  //We can already send a 200 back. The delta-notifier does not care about the
  //result, as long as the request is closed.
  res.status(200).send().end();

  try {
    await LOCK.acquire();
    //Don't trust the delta-notifier, filter as best as possible. We just need
    //the task that was created to get started.
    //Filter for tasks about the execute diff deletes operation.
    const actualTasks = req.body
      .map((changeset) => changeset.inserts)
      .filter((inserts) => inserts.length > 0)
      .flat()
      .filter(
        (insert) => insert.predicate.value === env.OPERATION_PREDICATE.value
      )
      .filter(
        (insert) => insert.object.value === env.SINGLETON_JOBS_OPERATION.value
      )
      .map((insert) => insert.subject);

    for (const taskURI of actualTasks) {
      const task = namedNode(taskURI.value);
      try {
        await tsk.updateTaskStatus(task, env.TASK_ONGOING_STATUS);
        const subjectBusy = await ts.isTaskBusyForSameSubject(task);
        if (subjectBusy)
          await tsk.updateTaskStatus(task, env.TASK_FAILURE_STATUS);
        else await tsk.updateTaskStatus(task, env.TASK_SUCCESS_STATUS);
      } catch (err) {
        logError(err.message, err);
        const savedErr = await saveTaskError(err.message, err);
        await tsk.updateTaskStatus(task, env.TASK_FAILURE_STATUS, savedErr);
      }
    }
  } catch (err) {
    const message =
      'The singleton-job task could not even be started or finished due to an unexpected problem.';
    logError(message, err);
    await saveTaskError(message, err);
  } finally {
    LOCK.release();
  }
});

///////////////////////////////////////////////////////////////////////////////
// Error handler
///////////////////////////////////////////////////////////////////////////////

/**
 * Logs a message to the command line, according to the loglevel environment
 * setting.
 *
 * @function
 * @param {String} message - An extra message on top of the error to indicate
 * where the error occured (or any other textual context).
 * @param {Error} err - Instance of the standard JavaScript Error class
 * or similar object that has a `message` property.
 * @returns {undefined} Nothing
 */
function logError(message, err) {
  if (env.LOGLEVEL === 'error' || env.LOGLEVEL === 'info')
    console.error(`${message}\n${err}`);
}

/**
 * Stores an error in the triplestore with a extra message.
 *
 * @async
 * @function
 * @param {String} message - An extra message on top of the error to indicate
 * where the error occured (or any other textual context).
 * @param {Error} err - Instance of the standard JavaScript Error class
 * or similar object that has a `message` property.
 * @returns {NamedNode} The error subject term that was created in the
 * triplestore.
 */
async function saveTaskError(message, err) {
  const errorStore = errorToStore(err, message);
  await saveError(errorStore);
  return errorStore.getSubjects(ns.rdf`type`, ns.oslc`Error`)[0];
}

///////////////////////////////////////////////////////////////////////////////
// Helpers
///////////////////////////////////////////////////////////////////////////////

/*
 * Produces an RDF store with the data to encode an error in the OSLC
 * namespace.
 *
 * @function
 * @param {Error} errorObject - Instance of the standard JavaScript Error class
 * or similar object that has a `message` property.
 * @param {String} [extraDetail] - Some more optional details about the error.
 * @returns {N3.Store} A new Store with the properties to represent the error.
 */
function errorToStore(errorObject, extraDetail) {
  const store = new N3.Store();
  const errorUuid = uuid();
  const error = b.error(errorUuid);
  const now = literal(new Date().toISOString(), ns.xsd`DateTime`);
  store.addQuad(error, ns.rdf`type`, ns.oslc`Error`);
  store.addQuad(error, ns.mu`uuid`, literal(errorUuid));
  store.addQuad(
    error,
    ns.dct`creator`,
    literal('harvesting-singleton-job-service')
  );
  store.addQuad(error, ns.oslc`message`, literal(errorObject.message));
  store.addQuad(error, ns.dct`created`, now);
  if (extraDetail)
    store.addQuad(error, ns.oslc`largePreview`, literal(extraDetail));
  return store;
}

/*
 * Receives a store with only the triples related to error messages and stores
 * them in the triplestore.
 *
 * @async
 * @function
 * @param {N3.Store} errorStore - Store with only error triples. (All of the
 * contents are stored.)
 * @returns {undefined} Nothing
 */
async function saveError(errorStore) {
  const writer = new N3.Writer();
  errorStore.forEach((q) => writer.addQuad(q));
  const errorTriples = await new Promise((resolve, reject) => {
    writer.end((err, res) => {
      if (err) reject(err);
      resolve(res);
    });
  });
  await mas.updateSudo(`
    INSERT DATA {
      GRAPH ${rst.termToString(env.ERROR_GRAPH)} {
        ${errorTriples}
      }
    }
  `);
}

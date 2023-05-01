# `harvesting-singleton-jobs-service`

This service reacts to messages from the `delta-notifier` about tasks in the
harvester stack. This service should be configured in the `jobs-controller` to
work as the first task in a pipeline, debouncing tasks for subjects that are
currently already busy in a different Job. For this, it searches for a Job in
the triplestore on the same subject as the newly started Job. If such Job can
be found, the newly created task (and therefore the Job as well) fails. If not,
the new Job can continue to run.

## How it works

This is one of the services that can be configured to use in the harvesting
application. It listens to scheduled tasks for the
`http://lblod.data.gift/id/jobs/concept/TaskOperation/singleton-job` operation
and queries the triplestore for other Jobs with the same subject as the current
Job.

## Adding to a stack

To add the service to a mu-semtech stack (probably something like a
[harvester](https://github.com/lblod/app-lblod-harvester/)), add the following
snippet to the `docker-compose.yml` file as a service:

```yaml
harvesting-singleton-job:
  image: lblod/harvesting-singleton-job-service:1.0.0
```

To make sure the delta-notifier sends the needed messages, add the following
snippet to the `rules.js` file:

```javascript
{
  match: {
    predicate: {
      type: 'uri',
      value: 'http://www.w3.org/ns/adms#status',
    },
    object: {
      type: 'uri',
      value: 'http://redpencil.data.gift/id/concept/JobStatus/scheduled',
    },
  },
  callback: {
    method: 'POST',
    url: 'http://harvesting-singleton-job/delta',
  },
},
```

As an example, the following snippet from the jobs-controllers `config.json`
shows how the jobs-controller can be configured to incorporate this service:

```json
{
  "currentOperation": null,
  "nextOperation": "http://lblod.data.gift/id/jobs/concept/TaskOperation/singleton-job",
  "nextIndex": "0"
},
{
  "currentOperation": "http://lblod.data.gift/id/jobs/concept/TaskOperation/singleton-job",
  "nextOperation": "http://lblod.data.gift/id/jobs/concept/TaskOperation/collecting",
  "nextIndex": "1"
},
```

## API

### POST `/delta`

Main entry point for this service. This is where delta messages arrive. Returns
a `200 OK` as soon as the request is being handled.

## Configuration

These are environment variables that can be used to configure this service.
Supply a value for them using the `environment` keyword in the
`docker-compose.yml` file.

### Environment variables

* `LOGLEVEL`: *(optional, default: "silent")* Possible values are `["error",
  "info", "silent"]`. On `silent`, no errors or informational messages are
  printed. On `error`, only error messages are printed to the console. On
  `info`, both error messages and informational messages such as data
  processing results are printed. The amount of information might be limited.
* `WRITE_ERRORS`: *(optional, default: "false", boolean)* Indicates if errors
  need to be written to the triplestore.
* `ERROR_GRAPH`: *(optional, default: "http://lblod.data.gift/errors")* Graph
  in the triplestore in which to write errors.
* `ERROR_BASE`: *(optional, default: "http://data.lblod.info/errors/")* URI
  base for constructing the subject of new Error individuals.


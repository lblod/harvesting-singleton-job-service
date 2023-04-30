import * as mas from '@lblod/mu-auth-sudo';
import * as env from '../env';
import * as rst from 'rdf-string-ttl';
import * as sjp from 'sparqljson-parse';
import * as N3 from 'n3';
import { NAMESPACES as ns } from '../env';
const { literal } = N3.DataFactory;

export async function isTaskBusyForSameSubject(task) {
  const response = await mas.querySudo(`
    ${env.SPARQL_PREFIXES}
    ASK {
      BIND (${rst.termToString(task)} AS ?task) .
      ?task
        a task:Task ;
        task:inputContainer ?inputContainer .
      ?inputContainer
        a nfo:DataContainer ;
        task:hasHarvestingCollection ?harvestingCollection .
      ?harvestingCollection
        a harv:HarvestingCollection ;
        dct:hasPart ?remoteDataObject .
      ?remoteDataObject
        a nfo:RemoteDataObject ;
        nie:url ?subject .

      VALUES ?status {
        js:scheduled
        js:busy
      }
      ?task2
        a task:Task ;
        dct:isPartOf ?job2 ;
        task:inputContainer ?inputContainer2 .
      FILTER (!SAMETERM(?task, ?task2)) .
      ?job2
        a cogs:Job ;
        adms:status ?status .
      ?inputContainer2
        a nfo:DataContainer ;
        task:hasHarvestingCollection ?harvestingCollection2 .
      ?harvestingCollection2
        a harv:HarvestingCollection ;
        dct:hasPart ?remoteDataObject2 .
      ?remoteDataObject2
        a nfo:RemoteDataObject ;
        nie:url ?subject .
    }
  `);

  const parser = new sjp.SparqlJsonParser();
  return parser.parseJsonBoolean(response);
}

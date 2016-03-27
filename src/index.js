/** == Imports == */
var AWS = require('aws-sdk'),
  _ = require('lodash'),
  querystring = require('querystring')

/*
 * The AWS credentials are picked up from the environment.
 * They belong to the IAM role assigned to the Lambda function.
 * Since the ES requests are signed using these credentials,
 * make sure to apply a policy that allows ES domain operations
 * to the role.
 */
var creds = new AWS.EnvironmentCredentials('AWS');

// TODO externalize env variable
var es = require('elasticsearch').Client({
  hosts: process.env.MEMBER_ES_HOST,
  apiViersion: '1.5',
  connectionClass: require('http-aws-es'),
  amazonES: {
    region: "us-east-1",
    credentials: creds
  }
});

exports.handler = function(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  var operation = getOperation(event, context)
  var body = event.body;

  switch (operation) {
    case 'ADMIN_SEARCH':
      // validate body and method
      if (!body.param || !body.method || !body.method.toLowerCase() === 'get') {
        context.fail(new Error("400_BAD_REQUEST: query is required"));
      } else {
        var searchQuery = body.param
        searchQuery._source = searchQuery._source || {};
        searchQuery._source.exclude = searchQuery._source.exclude || [];
        var excludedFields = ["firstName", "lastName", "email", "addresses", "financial"];
        searchQuery._source.exclude = searchQuery._source.exclude.concat(excludedFields);
        executeSearch(searchQuery, context)
      }
      break
    case 'MEMBER_SEARCH':
      // make sure name param was passed is non-empty
      var handle = _.get(event.queryParams, 'handle', null),
        queryType = _.get(event.queryParams, 'query', 'MEMBER_SEARCH'),
        limit = _.get(event.queryParams, 'limit', 11),
        offset = _.get(event.queryParams, 'offset', 0);
      if (!queryType || !handle) {
        context.fail(new Error("400_BAD_REQUEST: 'query' & 'handle' are required"));
      } else {
        var searchQuery = {
          "from": offset,
          "size": limit,
          "query": {
            "filtered": {
              "query": {
                "bool": {
                  "should": [
                    { "term": { "handle.phrase": handle } },
                    { "term": { "handle": handle } }
                  ]
                }
              },
              "filter": {
                "bool": {
                  "should": [
                    { "exists": { "field": "description" } },
                    { "exists": { "field": "skills" } },
                    { "exists": { "field": "photoURL" } }
                  ],
                  "must": { "term": { "status": "active" } }
                }
              }
            }
          },
          "_source": {
            "include": ["createdAt", "tracks", "competitionCountryCode", "wins", "userId", "handle", "maxRating", "skills.name", "skills.score", "stats", "photoURL", "description"],
            "exclude": ["addresses", "financial", "lastName", "firstName", "email", "otherLangName"]
          }
        }

        executeSearch(searchQuery, context)
      }
      break

    default:
      context.fail(new Error('Unrecognized operation "' + operation + '"'));
  }
};

/**
 * @brief executes the search query
 */
function executeSearch(searchQuery, context) {
  // query es
  es.search({
    index: 'members',
    type: 'profile',
    body: searchQuery
  }).then(function(resp) {
    var content = resp.hits.hits.map(function(obj) {
      return obj._source;
    });
    context.succeed(wrapResponse(context, 200, content, resp.hits.total));
  }, function(err) {
    context.fail(new Error(err.message));
  })
}

function wrapResponse(context, status, body, count) {
  return {
    id: context.awsRequestId,
    result: {
      success: status === 200,
      status: status,
      metadata: {
        totalCount: count
      },
      content: body
    }
  }
}

/**
 * @brief Determine description based on request context
 * 
 * @param event lambda event obj
 * @param context lambda context
 * 
 * @return String operation
 */
function getOperation(event, context) {
  switch (event.httpMethod.toUpperCase()) {
    // case 'POST':
    //   if (event.resourcePath.endsWith('_search') || event.resourcePath.endsWith('_search/'))
    //     return 'ADMIN_SEARCH'
    case 'GET':
      if (event.resourcePath.endsWith('_search') || event.resourcePath.endsWith('_search/'))
        return 'MEMBER_SEARCH'
    default:
      return null
      return null
  }
}

String.prototype.endsWith = function(str) {
  var lastIndex = this.lastIndexOf(str);
  return (lastIndex !== -1) && (lastIndex + str.length === this.length);
}

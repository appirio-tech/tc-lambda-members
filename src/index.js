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
        // make sure handle is lowercase
        handle = handle.toLowerCase()
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
                    { "exists": { "field": "photoURL" } },
                    { "exists": { "field": "description" } },
                    {
                      "nested": {
                        "path": "skills",
                        "filter": { "exists": { "field": "skills"}},
                        "_cache": true
                      }
                    }
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
      var response = obj._source

      // Temporary default values until default values can be set with logstash
      response.tracks    = response.tracks || []
      response.skills    = response.skills || []
      response.wins      = response.wins || 0
      response.maxRating = response.maxRating || { rating: 0 }
      response.stats     = response.stats || {
        COPILOT: {},
        DESIGN:{
          wins: 0,
          mostRecentSubmission:0,
          challenges: 0,
          subTracks: [],
          mostRecentEventDate: 0
        },
        DEVELOP: {
          challenges: 0,
          mostRecentEventDate: 0,
          mostRecentSubmission: 0,
          subtracks: [],
          wins: 0
        },
        DATA_SCIENCE:{
          wins: 0,
          challenges: 0,
          MARATHON_MATCH: {
            wins: 0,
            challenges: 0,
            rank: {
              maximumRating: 0,
              rating: 0,
              avgRank: 0,
              rank: 0,
              countryRank: 0,
              bestRank: 0,
            },
            mostRecentEventName: null
          },
          SRM:{
            wins:0,
            challenges:0,
            rank:{
              minimumRating:0,
              maximumRating:0,
              rating:0,
              rank:0,
              countryRank:0
            },
            mostRecentEventName:null
          }
        }
      }

      return response;
    });

    console.log('Content', JSON.stringify(content, null, 2))

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

/** == Imports == */
var AWS = require('aws-sdk'),
  _ = require('lodash'),
  jwt = require('jsonwebtoken'),
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

exports.handler = function(event, context, callback) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  var operation = getOperation(event, context)
  var body = event.body;

  switch (operation) {
    case 'SEARCH':
      var queryString = decodeURIComponent(event.params.querystring.query || '*')
        // convert + to space -
      queryString = queryString.replace(/\+/g, ' ')

      var excludedFields = ["addresses", "financial", "lastName", "firstName", "email", "otherLangName"]
        // allow certain fields only if user is admin
      var token = _.get(event.params.header, 'Authorization', '').split(' ')
      if (token.length === 2 && isAdmin(token[1])) {
        excludedFields = _.without(excludedFields, 'lastName', 'firstName', 'email')
      }

      // construct the query
      var searchQuery = {
        query: {
          filtered: {
            query: {
              query_string: {
                query: queryString
                  // fields: ["createdAt", "tracks", "competitionCountryCode", "wins", "userId", "handle", "maxRating", "photoURL"],
              }
            }
          }
        },
        _source: {
          "exclude": excludedFields
        },
        from: _.get(event, 'params.querystring.offset', 0),
        size: _.get(event, 'params.querystring.limit',50)
      };
      // add status filter
      if (event.params.querystring.status) {
        searchQuery.query.filtered.filter = {
          term: {
            status: event.params.querystring.status.toLowerCase()
          }
        };
      }
      executeSearch(searchQuery, context, callback)
      break
    case 'MEMBER_SEARCH':
      console.log('Invoking member search query')
        // make sure name param was passed is non-empty
      var handle = _.get(event, 'params.querystring.handle', null),
        queryType = _.get(event, 'params.querystring.query', 'MEMBER_SEARCH'),
        limit = _.get(event, 'params.querystring.limit', 11),
        offset = _.get(event, 'params.querystring.offset', 0);
      if (!queryType || !handle) {
        callback(new Error("400_BAD_REQUEST: 'query' & 'handle' are required"));
      } else {
        // make sure handle is lowercase
        handle = decodeURIComponent(handle.toLowerCase())
        var searchQuery = {
          "from": offset,
          "size": limit,
          "query": {
            "filtered": {
              "query": {
                "bool": {
                  "should": [{
                    "term": {
                      "handle.phrase": handle
                    }
                  }, {
                    "term": {
                      "handle": handle
                    }
                  }]
                }
              },
              "filter": {
                "bool": {
                  "should": [{
                    "exists": {
                      "field": "photoURL"
                    }
                  }, {
                    "exists": {
                      "field": "description"
                    }
                  }, {
                    "nested": {
                      "path": "skills",
                      "filter": {
                        "exists": {
                          "field": "skills"
                        }
                      },
                      "_cache": true
                    }
                  }],
                  "must": {
                    "term": {
                      "status": "active"
                    }
                  }
                }
              }
            }
          },
          "_source": {
            "include": ["createdAt", "tracks", "competitionCountryCode", "wins", "userId", "handle", "maxRating", "skills.name", "skills.score", "stats", "photoURL", "description"],
            "exclude": ["addresses", "financial", "lastName", "firstName", "email", "otherLangName"]
          }
        }

        executeSearch(searchQuery, context, callback)
      }
      break

    default:
      callback(new Error('Unrecognized operation "' + operation + '"'));
  }
};

/**
 * @brief executes the search query
 */
function executeSearch(searchQuery, context, callback) {
  // query es
  es.search({
    index: 'members',
    type: 'profile',
    body: searchQuery
  }).then(function(resp) {
    var content = resp.hits.hits.map(function(obj) {
      var response = obj._source

      // Temporary default values until default values can be set with logstash
      response.tracks = response.tracks || []
      response.skills = response.skills || []
      response.wins = response.wins || 0
      response.maxRating = response.maxRating || {
        rating: 0
      }
      response.stats = response.stats || {
        COPILOT: {},
        DESIGN: {
          wins: 0,
          mostRecentSubmission: 0,
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
        DATA_SCIENCE: {
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
          SRM: {
            wins: 0,
            challenges: 0,
            rank: {
              minimumRating: 0,
              maximumRating: 0,
              rating: 0,
              rank: 0,
              countryRank: 0
            },
            mostRecentEventName: null
          }
        }
      }

      return response;
    });

    console.log('Content', JSON.stringify(content, null, 2))

    callback(null, wrapResponse(context, 200, content, resp.hits.total));
  }, function(err) {
    callback(new Error(err.message));
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
 * verify that an admin is making this call
 */
function isAdmin(token) {
  if (!token)
    return false
  var decoded = jwt.decode(token)
  return _.indexOf(decoded.roles, 'administrator') > -1
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
  switch (event.context['http-method'].toUpperCase()) {
    case 'GET':
      if (event.context['resource-path'].endsWith('_search') || event.context['resource-path'].endsWith('_search/')) {
        return _.get(event.params, 'querystring.query', '') === 'MEMBER_SEARCH' ? 'MEMBER_SEARCH' : 'SEARCH'
      }
      return null
    default:
      return null
  }
}

String.prototype.endsWith = function(str) {
  var lastIndex = this.lastIndexOf(str);
  return (lastIndex !== -1) && (lastIndex + str.length === this.length);
}

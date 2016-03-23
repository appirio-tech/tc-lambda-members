/**
 * Add mocks here .. cos well.. just do it..
 */
var elasticsearch = require('elasticsearch')
var es = {}
elasticsearch.Client = function() {
  return es
}
require('es6-promise').polyfill();

var chai = require("chai");
var expect = require("chai").expect,
  lambdaToTest = require('./index.js');

sinon = require("sinon");
chai.use(require('sinon-chai'));
const context = require('aws-lambda-mock-context');

var testLambda = function(event, ctx, resp) {
  // Fires once for the group of tests, done is mocha's callback to 
  // let it know that an   async operation has completed before running the rest 
  // of the tests, 2000ms is the default timeout though
  before(function(done) {
    //This fires the event as if a Lambda call was being sent in
    lambdaToTest.handler(event, ctx)
      //Captures the response and/or errors
    ctx.Promise
      .then(function(response) {
        resp.success = response;
        done();
      })
      .catch(function(err) {
        resp.error = err;
        done();
      })
  })
}

describe('When receiving an invalid request', function() {
  var resp = { success: null, error: null };
  const ctx = context()
  testLambda({
    "stage": "test-invoke-stage",
    "requestId": "test-invoke-request",
    "resourcePath": "/v3/members/_search",
    "resourceId": "dxtdde",
    "httpMethod": "GET",
    "sourceIp": "test-invoke-source-ip",
    "userAgent": "Apache-HttpClient/4.3.4 (java 1.5)",
    "caller": "AIDAJJMZ5ZCBYPW45NZRC",
    "body": "{}",
    "queryParams": {
      "query": 'MEMBER_SEARCH',
      "handle": "",
      "limit": 10,
      "offset": 0
    }
  }, ctx, resp)

  describe('then response object ', function() {
    it('should be an error object', function() {
      console.log(resp.error)
      expect(resp.error).to.exist
        .and.be.instanceof(Error)
    })

    it('should contain 400 error msg', function() {
      expect(resp.error.message).to.match(/400_BAD_REQUEST/)
    })
  })
})


describe('When receiving a valid search request', function() {
  var resp = { success: null, error: null }
  const ctx = context()

  es.search = function(input) {
    return Promise.resolve({
      "took": 192,
      "timed_out": false,
      "_shards": {
        "total": 5,
        "successful": 5,
        "failed": 0
      },
      "hits": {
        "total": 100,
        "max_score": 3.4130113,
        "hits": [{
          "_index": "members",
          "_type": "profile",
          "_id": "11872271",
          "_score": 3.4130113,
          "_source": {
            "wins": 0,
            "updatedBy": "11872271",
            "challenges": 45,
            "handle": "alberto",
            "type": "jdbc",
            "userId": 11872271,
            "tracks": [
              "DATA_SCIENCE"
            ],
            "skills": [{
              "score": 22,
              "sources": [
                "CHALLENGE"
              ],
              "name": "Math",
              "id": "274"
            }],
            "photoURL": "https://www.topcoder.com/i/m/alberto_big.jpg",
            "createdAt": 1103360317000,
            "createdBy": "11872271",
            "stats": {},
            "maxRating": {
              "rating": 1579,
              "subTrack": "SRM",
              "track": "DATA_SCIENCE"
            },
            "competitionCountryCode": "BRA",
            "updatedAt": 1385045835000,
            "status": "ACTIVE"
          }
        }]
      }
    })
  }
  testLambda({
    "stage": "test-invoke-stage",
    "requestId": "test-invoke-request",
    "resourcePath": "/v3/members/_search",
    "resourceId": "dxtdde",
    "httpMethod": "GET",
    "sourceIp": "test-invoke-source-ip",
    "userAgent": "Apache-HttpClient/4.3.4 (java 1.5)",
    "caller": "AIDAJJMZ5ZCBYPW45NZRC",
    "body": "{}",
    "queryParams": {
      "query": 'MEMBER_SEARCH',
      "handle": "albert",
      "limit": 10,
      "offset": 0
    }
  }, ctx, resp)

  describe('then success response ', function() {
    var spy = sinon.spy(es, 'search')
    it('should be a valid response', function() {
      var result = resp.success.result
      console.log(result)
      expect(spy.calledOnce).to.be.true
      expect(resp.success.result).to.not.be.null
      expect(result.success).to.be.true
      expect(result.metadata).to.deep.equal({ totalCount: 100 })
      expect(result.status).to.equal(200)
      expect(result.content).to.have.lengthOf(1)
    })
  })
})

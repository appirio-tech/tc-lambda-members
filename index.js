/** == Imports == */
var AWS = require('aws-sdk');
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
    connectionClass: require('http-aws-es'),
    amazonES: {
        region: "us-east-1",
        credentials: creds
    }
});

exports.handler = function(event, context) {
    console.log('Received event:', JSON.stringify(event, null, 2));

    var operation = event.operation;
    var body = event.body;

    switch (operation) {
        case 'search':
            // validate body and method
            if (!body.param || !body.method || !body.method.toLowerCase() === 'get') {
                context.fail(new Error("Bad request"));
            }

            // exclude certain fields
            var searchQuery = body.param;
            searchQuery._source = searchQuery._source || {};
            searchQuery._source.exclude = searchQuery._source.exclude || [];
            var excludedFields = ["firstName", "lastName", "email", "addresses", "financial"];
            searchQuery._source.exclude = searchQuery._source.exclude.concat(excludedFields);

            // query es
            es.search({
                index: 'members',
                type: 'profile',
                body: searchQuery
            }).then(function(resp) {
                var content = resp.hits.hits.map(function(obj) {
                    return obj._source;
                });
                console.log(JSON.stringify(content, null, 2));
                context.succeed(wrapResponse(context, 200, content, resp.hits.total));
            }, function(err) {
                console.log(err.message)
                context.fail(new Error(err.message));
            })
            break;
        default:
            context.fail(new Error('Unrecognized operation "' + operation + '"'));
    }
};


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

#!/bin/bash
if [ "$TRAVIS_BRANCH" = "dev" ]; then
  export AWS_ACCESS_KEY_ID=$DEV_AWS_KEY
  export AWS_SECRET_ACCESS_KEY=$DEV_AWS_SECRET
  export MEMBER_ES_HOST=$DEV_MEMBER_ES_HOST
elif [ "$TRAVIS_BRANCH" = "release" ]; then
  export AWS_ACCESS_KEY_ID=$QA_AWS_KEY
  export AWS_SECRET_ACCESS_KEY=$QA_AWS_SECRET
  export MEMBER_ES_HOST=$QA_MEMBER_ES_HOST
elif [ "$TRAVIS_BRANCH" = "master" ]; then
  export AWS_ACCESS_KEY_ID=$PROD_AWS_KEY
  export AWS_SECRET_ACCESS_KEY=$PROD_AWS_SECRET
  export MEMBER_ES_HOST=$PROD_MEMBER_ES_HOST
fi

./node_modules/.bin/gulp deploy
"use strict";

var gulp = require('gulp'),
  zip = require('gulp-zip'),
  del = require('del'),
  install = require('gulp-install'),
  awsLambda = require('node-aws-lambda'),
  envify = require('gulp-envify'),
  _ = require('lodash'),
  runSequence = require('run-sequence'),
  sys = require('sys'),
  exec = require('child_process').exec,
  path = require('path');


gulp.task('clean', function(cb) {
  return del(['./dist', './dist.zip'], cb);
});

gulp.task('js', function() {
  return gulp.src(['src/index.js'])
    .pipe(envify(process.env))
    .pipe(gulp.dest('dist/'));
});

gulp.task('node-mods', function() {
  return gulp.src('./package.json')
    .pipe(gulp.dest('dist/'))
    .pipe(install({
      production: true
    }));
});

gulp.task('zip', function() {
  return gulp.src(['dist/**/*', '!dist/package.json'])
    .pipe(zip('dist.zip'))
    .pipe(gulp.dest('./'));
});

gulp.task('upload', function(callback) {
  var packageDefinition = require(path.join(process.cwd(), './package.json'))
  var lambdaConfig = packageDefinition.lambda;
  // set defaults
  _.defaultsDeep(lambdaConfig, {
    profile: process.env.AWS_PROFILE,
    region: 'us-east-1',
    handler: 'index.handler',
    description: "",
    role: 'arn:aws:iam::' + process.env.AWS_ACCOUNT_ID + ':role/' + (packageDefinition.lambda.roleName || 'aws-lambda-default'),
    timeout: 180,
    memorySize: 512
  });
  // to work around jenkins multi-branch plugin
  var cb = function(_cfg) {
    console.log("Deploying with lambdaConfig: ", JSON.stringify(_cfg, null, 2))
    awsLambda.deploy(
      './dist.zip', _cfg,
      callback);
  };
  if (process.env.ENVIRONMENT === 'dev') {
    lambdaConfig.functionName += "-dev";
    cb(lambdaConfig);
  } else if (process.env.ENVIRONMENT === 'qa') {
    lambdaConfig.functionName += "-qa";
    cb(lambdaConfig);
  } else if (process.env.ENVIRONMENT === 'prod') {
    lambdaConfig.functionName += "-prod";
    cb(lambdaConfig);
  } else {
    exec("git symbolic-ref -q --short head", function(err, stdout, stderr) {
      if (err) {
        throw err;
      } else if (stderr) {
        throw new Error(stderr)
      } else {
        // update lambda functionName with branch
        if (stdout.indexOf('master') > -1) {
          lambdaConfig.functionName += "-prod";
        } else if (stdout.indexOf('release') > -1) {
          lambdaConfig.functionName += "-qa";
        } else if (stdout.indexOf('dev') > -1) {
          lambdaConfig.functionName += "-dev";
        }
        cb(lambdaConfig);
      }
    })
  }
});

gulp.task('deploy', function(callback) {
  return runSequence(
    ['clean'], ['js', 'node-mods'],
    // ADD ANY FILE YOU WANT TO THE dist/ folder
    ['zip'], ['upload'],
    callback
  );
});

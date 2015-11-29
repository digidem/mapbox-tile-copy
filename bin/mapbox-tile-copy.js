#!/usr/bin/env node

/* eslint no-process-exit: 0, no-path-concat: 0, no-octal-escape: 0 */

// Our goal is a command that can be invoked something like this:
// $ mapbox-tile-copy /path/to/some/file s3://bucket/folder/{z}/{x}/{y} --part=1 --parts=12
//
// We should use exit codes to determine next-steps in case of an error
// - exit 0: success!
// - exit 1: unexpected failure -> retry
// - exit 3: invalid data -> do no retry

// Perform some performance adjustments early on
var maxThreads = Math.ceil(Math.max(4, require('os').cpus().length * 1.5));
process.env.UV_THREADPOOL_SIZE = maxThreads;

var util = require('util');
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var url = require('url');
http.globalAgent.maxSockets = 30;
https.globalAgent.maxSockets = 30;

var mapboxTileCopy = require('../index.js');
var s3urls = require('s3urls');
var argv = require('minimist')(process.argv.slice(2), {
  boolean: ['retina'],
  default: {retina: true}
});

if (!argv._[0]) {
  process.stdout.write(fs.readFileSync(__dirname + '/help', 'utf8'));
  process.exit(1);
}

var srcfile = argv._[0];
var dsturi = argv._[1];
var options = {};

options.progress = getProgress;

options.stats = !!argv.stats;

if (!!argv.minzoom) {
  if (isNumeric(argv.minzoom)) {
    options.minzoom = argv.minzoom;
  }
  else {
    console.error('You must provide a valid zoom level integer');
    process.exit(1);
  }
}

var interval = argv.progressinterval === undefined ? -1 : Number(argv.progressinterval);

if (interval > 0) {
  setInterval(report, interval * 1000);
}

if (isNumeric(argv.part) && isNumeric(argv.parts)) options.job = {
  total: argv.parts,
  num: argv.part
};

if (isNumeric(argv.retry)) options.retry = parseInt(argv.retry, 10);
if (isNumeric(argv.timeout)) options.timeout = parseInt(argv.timeout, 10);

if (!dsturi || !s3urls.valid(dsturi)) {
  console.error('You must provide a valid S3 url');
  process.exit(1);
}

var parsedDstUrl = url.parse(dsturi)
var ext = path.extname(parsedDstUrl.pathname).slice(1)
var FORMATS = 'jpg,jpeg,png,webp'.split(',')

if (argv.format) {
  if (FORMATS.indexOf(argv.format) === -1) {
    console.error('--format must be one of: %s', FORMATS.join(','))
    process.exit(1)
  }
  options.format = argv.format
} else if (ext && FORMATS.indexOf(ext) > -1) {
  options.format = (ext === 'jpg') ? 'jpeg' : ext
} else {
  options.format = 'webp'
}

options.retina = argv.retina

fs.exists(srcfile, function(exists) {
  if (!exists) {
    console.error('The file specified does not exist: %s', srcfile);
    process.exit(1);
  }

  mapboxTileCopy(srcfile, dsturi, options, function(err, stats) {
    if (err) {
      console.error(err.stack);
      process.exit(err.code === 'EINVALID' ? 3 : 1);
    }

    if (argv.stats) {
      fs.writeFile(argv.stats, JSON.stringify(stats), done);
    } else {
      done();
    }

    function done() {
      if (interval !== 0) report(true);
      process.exit(0);
    }
  });
});

var stats, p;

function getProgress(statistics, prog) {
  stats = statistics;
  p = prog;
  if (interval < 0) report();
}

function report(final) {
  if (!stats || !p) return;
  util.print(util.format('%s%s tiles @ %s/s, %s% complete [%ss]%s',
    interval > 0 ? '' : '\r\033[K',
    p.transferred,
    Math.round(p.speed),
    Math.round(p.percentage),
    p.runtime,
    interval > 0 || final ? '\n' : ''
  ));
}

function isNumeric(num) {
  return !isNaN(parseFloat(num));
}

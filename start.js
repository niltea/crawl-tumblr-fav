'use strict';// test script
/* eslint-disable no-console */

const event = {
	is_local : true,
};

const context = {};

const callback = function(err, data) {
	if (err) console.log(err);
	if (data) console.log(data);
	return;
};

const index = require('./index.js');
index.handler(event, context, callback);

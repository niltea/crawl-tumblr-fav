'use strict';
/*global process:false*/
const is_saveLocal = false;
const is_unLike = false;

const tumblr = require('tumblr');
const AWS = require('aws-sdk');
const https = require('https');
const request = require('request');
const url = require('url');
const fs = require('fs');

// get credentials
const env = process.env;
const conf = {
	posts_limit  : env.posts_limit,
	imgSavePath  : 'images/',
	TumblrAuth   : {
		consumer_key   : env.tumblr_consumer_key,
		consumer_secret: env.tumblr_consumer_secret,
		token          : env.token,
		token_secret   : env.token_secret
	},
	slack        : {
		url      : env.slack_webhook_URL,
		icon_url : env.slack_icon_url,
		username : env.slack_username,
		channel  : env.slack_channel,
	},
	aws          : {
		accessKeyId    : env.aws_accessKeyId,
		secretAccessKey: env.aws_secretAccessKey,
		region         : env.aws_region,
	},
	bucket       : env.aws_s3_saveBucket,
};

// init slack user func
const user = new tumblr.User(conf.TumblrAuth);
const unlikePost = (id, reblog_key) => {
	return new Promise((resolve, reject) => {
		user.unlike({id, reblog_key}, (err, res) => {
			if (err) {
				reject(err);
				return;
			}
			resolve('unliked: ' + id);
		});
	});
};

// init S3
const s3 = is_saveLocal ? null : new AWS.S3(conf.aws);

// save locally
const saveLocal = (body, fileMeta) => {
	const path = fileMeta.dest + fileMeta.fileName;

	return new Promise((resolve, reject) => {
		fs.mkdir(fileMeta.dest, (err) => {
			if (err && err.code !== 'EEXIST'){
				reject(err);
				return false;
			}
			fs.writeFile(path, body, 'binary', (err) => {
				if (err){
					reject(err);
					return false;
				}
				resolve(`Saved to Local: ${path}`);
				return true;
			});
		});
	});
};
const saveS3 = (body, fileMeta) => {
	const s3Prop = fileMeta.objectProp;
	s3Prop.Body = body;

	return new Promise((resolve, reject) => {
		s3.putObject(s3Prop, (err) => {
			if (err) {
				reject(err);
				return false;
			}
			resolve(`Saved to S3: ${s3Prop.Key}`);
			return true;
		});
	});
};

// select save function
const saveFunc = is_saveLocal ? saveLocal : saveS3;

// 画像の保存を行う
// fileData : Object {
	// id          : post id,
	// reblog_key  : reblog_key,
	// body        : file body
	// fileMeta    : meta
	// isFirst     : sets true if the image is FIRST of photoset
	// isLast      : sets true if the image is LAST of photoset
	// slack       : slack payload (if not first image : null)
// }
const saveImage = (fileData, callback) => {
	if(!fileData.body) {
		callback(`err: no body - ${fileData.fileMeta.fileName}`);
		return;
	}
	saveFunc(fileData.body, fileData.fileMeta).then(retVal => {
		callback(null, retVal);
		if (fileData.slack) {
			postSlack(fileData.slack, callback);
		};
		if (fileData.isLast && is_unLike) {
			unlikePost(fileData.id, fileData.reblog_key).then(retVal => {
				callback(null, retVal);
			}).catch(err => callback(err));
		}
	}).catch(err => callback(err));
};

// 画像のフェッチを行う
const fetchImage = (fetchParam) => {
	return new Promise((resolve, reject) => {
		const req = https.request(fetchParam, (res) => {
			let data = [];
			res.on('data', (chunk) => { data.push(chunk); });
			res.on('end', () => {
				resolve(Buffer.concat( data ));
			});
		});
		req.end();
		req.on('error', (err) => {
			reject(err);
		});
	});
};

const setRequestParam = (mediaIdURL) => {
	// URLが入ってなかったらreturn
	if (mediaIdURL.url === undefined) return false;
	const imgSavePath = conf.imgSavePath;
	const ext = mediaIdURL.url.match(/\.[a-zA-Z0-9]+$/)[0];
	const fileName = mediaIdURL.url.match(/.+\/(.+?)([\?#;].*)?$/)[1];
	// content typeを拡張子から判定
	const contentType = (() => {
		if (ext === '.jpg') return 'image/jpeg';
		if (ext === '.gif') return 'image/gif';
		if (ext === '.png') return 'image/png';
		if (ext === '.bmp') return 'image/x-bmp';
		if (ext === '.mp4') return 'image/mp4';
		return null;
	})();
	const _url = url.parse(mediaIdURL.url);
	// クエリパラメーター生成
	const fetchParam = {
		method   : 'GET',
		hostname : _url.hostname,
		path     : _url.path,
	};

	// 保存ファイルのメタデーター作成
	const fileMeta = {
		dest       : imgSavePath,
		fileName   : fileName,
		objectProp : {
			Bucket      : conf.bucket,
			Key         : fileName,
			ContentType : contentType
		}
	};
	return {fetchParam, fileMeta};
};

// 画像のフェッチを行い、保存する
const fetchSaveImages = (photo_urls, callback) => {
	photo_urls.forEach((photo) => {
		// 渡されたURLをForeachし、Fetchパラメーターを付加する
		photo.requestParam = setRequestParam(photo);

		// パラメータをもとにファイルのFetchと保存
		fetchImage(photo.requestParam.fetchParam).then(body => {
			saveImage({
				id          : photo.id,
				reblog_key  : photo.reblog_key,
				body        : body,
				fileMeta    : photo.requestParam.fileMeta,
				isFirst     : photo.isFirst,
				isLast      : photo.isLast,
				slack       : photo.slack,
			}, callback);
		}).catch(err => callback(err));
	});
};

const getPhotoURL = (photos) => {
	let photo_urls = [];

	photos.forEach(photo => {
		if(!photo || !photo.original_size) return null;
		photo_urls.push(photo.original_size.url);
	});
	return photo_urls;
};

const postSlack = (slackPayload, callback) => {
	const options = { json: slackPayload };
	request.post(conf.slack.url, options, (error, response) => {
		if (response.statusCode != 200) {
			callback(`errror posting Slack: ${response.statusCode} ${response.body}`);
			return;
		}
	});
	return;
};

const generateSlackPayload = (text, isWatchdog) => {
	if (disableSlack) return null;
	const icon_url = conf.slack.icon_url;
	const username = conf.slack.username;
	const channel  = conf.slack.channel;
	if (isWatchdog) {
		text = 'いきてるよー。';
	}
	return {icon_url, username, channel, text};
};

const fetchFav = () => {
	const limit = conf.posts_limit || 20;
	return new Promise((resolve, reject) => {
		user.likes({limit: limit}, (err, res) => {
			if (err) {
				reject(err);
				return;
			}
			let photo_urls = [];
			res.liked_posts.forEach((post) => {
				if (post.type === 'photo') {
					const _photos = getPhotoURL(post.photos);
					const lastIndex = _photos.length - 1;
					const slackPostURL = (post.post_url + '/').match(/(http|https):\/\/[a-z0-9\-\.]+\/post\/[0-9]+\//)[0];
					const slackMsg = 'Favした画像だよ。\n' + slackPostURL;
					const slackPayload = generateSlackPayload(slackMsg);
					_photos.forEach((photo, index) => photo_urls.push({
						id         : post.id,
						reblog_key : post.reblog_key,
						url        : photo,
						isFirst    : (index === 0) ? true : false,
						isLast     : (index === lastIndex) ? true : false,
						slack      : (index === 0) ? slackPayload : null,
					}));
					return;
				}
				if (post.type === 'video') {
					if (post.video_type === 'vine') return null;
					if (post.video_type === 'flickr') return null;
					const lastIndex = 0;
					const slackMsg = 'Favした動画だよ。\n' + post.post_url;
					const slackPayload = generateSlackPayload(slackMsg);
					photo_urls.push({
						id         : post.id,
						reblog_key : post.reblog_key,
						url        : post.video_url,
						isFirst    : true,
						isLast     : true,
						slack      : slackPayload,
					});
					return;
				}
				return null;
			});
			resolve(photo_urls);
		});
	});
};

exports.handler = (event, context, callback) => {
	const imgList = fetchFav();
	imgList.then((photo_urls) => {
		fetchSaveImages(photo_urls, callback);
	}).catch(err => callback(err));
};
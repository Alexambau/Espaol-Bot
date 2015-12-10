/*
	Settings Manager
*/

const settingsDataFile = './data/settings.json';
const cacheDataFile = './data/' + '_temp/' + 'http-cache.json';

var settings = exports.settings = {};

if (!fs.existsSync(settingsDataFile))
	fs.writeFileSync(settingsDataFile, '{}');

try {
	settings = exports.settings = JSON.parse(fs.readFileSync(settingsDataFile).toString());
} catch (e) {
	errlog(e.stack);
	error("Could not import settings: " + sys.inspect(e));
}

var FlatFileManager = exports.FlatFileManager = (function () {
	function FlatFileManager (file) {
		this.file = file;
		if (!fs.existsSync(file))
			fs.writeFileSync(file, '{}');
		this.writing = false;
		this.writePending = false;
		this.dataPending = null;
	}

	FlatFileManager.prototype.read = function () {
		return fs.readFileSync(this.file).toString();
	};

	FlatFileManager.prototype.readObj = function () {
		return JSON.parse(this.read());
	};

	FlatFileManager.prototype.write = function (data) {
		var self = this;
		var finishWriting = function () {
			self.writing = false;
			if (self.writePending) {
				self.writePending = false;
				self.write(self.dataPending);
				self.dataPending = null;
			}
		};
		if (self.writing) {
			self.writePending = true;
			self.dataPending = data;
			return;
		}
		fs.writeFile(self.file + '.0', data, function () {
			// rename is atomic on POSIX, but will throw an error on Windows
			fs.rename(self.file + '.0', self.file, function (err) {
				if (err) {
					// This should only happen on Windows.
					fs.writeFile(self.file, data, finishWriting);
					return;
				}
				finishWriting();
			});
		});
	};

	FlatFileManager.prototype.writeObj = function (obj) {
		this.write(JSON.stringify(obj));
	};

	return FlatFileManager;
})();

var writing = exports.writing = false;
var writePending = exports.writePending = false;
var save = exports.save =  function () {
	var data = JSON.stringify(settings);
	var finishWriting = function () {
		writing = false;
		if (writePending) {
			writePending = false;
			save();
		}
	};
	if (writing) {
		writePending = true;
		return;
	}
	fs.writeFile(settingsDataFile + '.0', data, function () {
		// rename is atomic on POSIX, but will throw an error on Windows
		fs.rename(settingsDataFile + '.0', settingsDataFile, function (err) {
			if (err) {
				// This should only happen on Windows.
				fs.writeFile(settingsDataFile, data, finishWriting);
				return;
			}
			finishWriting();
		});
	});
};

exports.userCan = function (room, user, permission) {
	var rank;
	if (!settings['commands'] || !settings['commands'][room] || typeof settings['commands'][room][permission] === "undefined") {
		rank = Config.defaultPermission;
		if (Config.permissionExceptions[permission]) rank = Config.permissionExceptions[permission];
	} else {
		rank = settings['commands'][room][permission];
	}
	return Tools.equalOrHigherRank(user, rank);
};

var permissions = exports.permissions = {};
exports.addPermissions = function (perms) {
	for (var i = 0; i < perms.length; i++) {
		permissions[perms[i]] = 1;
	}
};

var seen = exports.seen = {};
var reportSeen = exports.reportSeen = function (user, room, action, args) {
	if (!args) args = [];
	user = toId(user);
	var dSeen = {};
	dSeen.time = Date.now();
	if (!(room in Config.privateRooms)) {
		dSeen.room = room;
		dSeen.action = action;
		dSeen.args = args;
	}
	seen[user] = dSeen;
};

var httpCache = exports.httpCache = {};

var cacheFFM = exports.cacheFFM = new FlatFileManager(cacheDataFile);

try {
	httpCache = exports.httpCache = cacheFFM.readObj();
} catch (e) {
	errlog(e.stack);
	error("Could not import http cache: " + sys.inspect(e));
}

exports.httpGetAndCache = function (url, callback, onDownload) {
	for (var i in httpCache) {
		if (httpCache[i].url === url) {
			fs.readFile('./data/' + '_temp/' + i, function (err, data) {
				if (err) {
					Settings.unCacheUrl(url);
					if (typeof callback === "function") callback(null, err);
					return;
				}
				if (typeof callback === "function") callback(data.toString(), null);
			});
			return;
		}
	}
	if (typeof onDownload === "function") onDownload();
	Tools.httpGet(url, function (data, err) {
		if (err) {
			if (typeof callback === "function") callback(null, err);
			return;
		}
		var file;
		do {
			file = "cache.http." + Tools.generateRandomNick(5) + ".tmp";
		} while (httpCache[file]);
		fs.writeFile('./data/' + '_temp/' + file, data, function (err) {
			if (!err) {
				httpCache[file] = {url: url, time: Date.now()};
				cacheFFM.writeObj(httpCache);
			}
			if (typeof callback === "function") callback(data, null);
		});
	});
};

exports.unCacheUrl = function (url) {
	var uncache, changed = false;
	for (var file in httpCache) {
		uncache = false;
		if (typeof url === "string") {
			if (url === httpCache[file].url) uncache = true;
		} else if (typeof url === "object" && url instanceof RegExp) {
			if (url.test(httpCache[file].url)) uncache = true;
		}
		if (uncache) {
			try {
				fs.unlinkSync('./data/' + '_temp/' + file);
			} catch (err) {
				debug(err.stack);
				debug("Could not remove cache file: " +'./data/' + '_temp/' + file);
			}
			delete httpCache[file];
			changed = true;
		}
	}
	if (changed) cacheFFM.writeObj(httpCache);
};

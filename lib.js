var fs = require('fs'),
    util = require('util');

exports.writeCron = function(hour, minute, callback) {
    hour = hour || Math.floor(Math.random() * 7); // randomize hour between 0 and 6
    minute = minute || Math.floor(Math.random() * 60); // randomize minute between 0 and 59

    fs.writeFile(
        '/etc/cron.d/emergence-backup',
        util.format('%d %d\t* * *\troot\temergence-backup', minute, hour),
        'ascii',
        function(error) {
            if (error) {
                return callback(error);
            }

            callback(null, hour, minute);
        }
    );
};
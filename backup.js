#!/usr/bin/env node

var fs = require('fs'),
    zlib = require('zlib'),
    async = require('async'),
    winston = require('winston'),
    sequest = require('sequest'),
    rsync = require('rsyncwrapper').rsync,
    child_process = require('child_process');

// paths
var backupServicePath = '/emergence/services/backup',
    configPath = backupServicePath + '/config.json',
    privateKeyPath = backupServicePath + '/id_rsa',
    logsPath = backupServicePath + '/logs';


// verify backup service is configured
if (
    !fs.existsSync(backupServicePath) ||
    !fs.existsSync(configPath) ||
    !fs.existsSync(privateKeyPath)
) {
    throw new Error('Backup service has not been configured yet, run emergence-backup-setup');
}


// configure logger
if (!fs.existsSync(logsPath)){
    fs.mkdirSync(logsPath, '700');
}

winston.add(winston.transports.DailyRotateFile, {
    filename: logsPath + '/backup'
});


// load config
winston.info('Loading config...');
var config = JSON.parse(fs.readFileSync(configPath));
winston.info('Loaded config:', config);


// connect to SSH
winston.info('Creating SSH connection...');
var ssh = sequest.connect({
    host: config.host,
    username: config.user,
    privateKey: fs.readFileSync(privateKeyPath)
});


// execute backup
winston.info('Executing backup...');

async.auto({
    getToday: function(callback) {
        callback(null, (new Date()).toISOString().split('T')[0]);
    },

    getEmergenceConfig: function(callback) {
        fs.readFile('/emergence/config.json', 'ascii', function(error, data) {
            if (error) {
                return callback(error);
            }

            callback(null, JSON.parse(data));
        });
    },

    getRemoteHome: function(callback) {
        winston.info('Checking home directory...');
        ssh('echo $HOME', function(error, output, info) {
            if (error) {
                return callback(error);
            }

            var home = output.trim();

            if (!home) {
                winston.error('Failed to get home directory', info);
                return callback('Failed to get home directory');
            }

            winston.info('Remote home directory:', home);

            callback(null, home);
        });
    },

    getRemoteSnapshotDirectory: [
        'getRemoteHome',
        function(callback, results) {
            var snapshotsRootPath = results.getRemoteHome + '/emergence-sites';

            winston.info('Creating remote directory %s...', snapshotsRootPath);
            ssh('mkdir -p ' + snapshotsRootPath + '/logs && chmod -R 700 ' + snapshotsRootPath, function(error, output, info) {
                if (error) {
                    return callback(error);
                }

                if (info.code != 0) {
                    return callback('Failed to create directory: ' + snapshotsRootPath);
                }

                callback(null, snapshotsRootPath);
            });
        }
    ],

    getLastSnapshot: [
        'getRemoteSnapshotDirectory',
        function(callback, results) {
            var snapshotsRootPath = results.getRemoteSnapshotDirectory;

            winston.info('Finding latest snapshot...');
            ssh('ls -1r ' + snapshotsRootPath, function(error, output, info) {
                if (error) {
                    return callback(error);
                }

                output = output.trim();

                if (!output) {
                    winston.error('Failed to list existing snapshots:', info);
                    return callback('Snapshot listing failed');
                }

                var directoryRe = /^\d{4}-\d{2}-\d{2}$/,
                    directories = output.split('\n').filter(function(directory) {
                        return directoryRe.test(directory);
                    }),
                    latestSnapshot;

                directories.sort();
                winston.info('Found %s existing snapshots', directories.length);

                if (directories.length) {
                    latestSnapshot = directories[directories.length-1];
                    callback(null, latestSnapshot);
                } else {
                    callback(null, null);
                }
            });
        }
    ],

    initializeSnapshot: [
        'getToday',
        'getRemoteSnapshotDirectory',
        'getLastSnapshot',
        function(callback, results) {
            var snapshotsRootPath = results.getRemoteSnapshotDirectory,
                lastSnapshot = results.getLastSnapshot,
                lastSnapshotPath = lastSnapshot && snapshotsRootPath + '/' + lastSnapshot,
                today = results.getToday,
                snapshotPath = snapshotsRootPath + '/' + today;

            if (!lastSnapshot) {
                winston.info('Starting new snapshot at %s...', snapshotPath);
                ssh(['mkdir', snapshotPath].join(' '), function(error, output, info) {
                    callback(error, snapshotPath);
                });
            } else if (lastSnapshot != today) {
                winston.info('Starting snapshot %s from %s...', snapshotPath, lastSnapshotPath);
                ssh(['cp -al', lastSnapshotPath, snapshotPath].join(' '), function(error, output, info) {
                    callback(error, snapshotPath);
                });
            } else {
                winston.info('Updating existing snapshot %s...', snapshotPath);
                callback(null, snapshotPath);
            }
        }
    ],

    uploadSnapshot: [
        'getToday',
        'getRemoteSnapshotDirectory',
        'initializeSnapshot',
        function(callback, results) {
            var today = results.getToday,
                remoteLogPath = results.getRemoteSnapshotDirectory + '/logs/' + today + '.gz',
                snapshotPath = results.initializeSnapshot;

            winston.info('Rsyncing snapshot to %s...', snapshotPath);

            rsync({
                host: config.user + '@' + config.host,
                privateKey: privateKeyPath,
                //noExec: true,

                src: '/emergence/sites/',
                dest: snapshotPath,

                //dryRun: true,
                recursive: true,
                deleteAll: true,
                exclude: [
                    '*.log', // log files
                    'site-data/media/*x*' // cached media thumbnails
                ],

                args: [
                    '-a',
                    '-i',
                    '--chmod=-rwx,ug+Xr,u+w',
                    '--links',
                    '--compress'
                ]
            }, function(error, stdout, stderr, cmd) {
                if (error) {
                    return callback(error);
                }

                stdout = (stdout || '').trim();
                winston.info('Snapshot rsync finished, items changed:', stdout ? stdout.split(/\n/).length : 0);
                winston.verbose('rsync output:\n' + stdout);

                // TODO: don't overwrite existing log if it's an update
                var remoteLog = ssh.put(remoteLogPath),
                    gzip = zlib.createGzip();

                winston.info('Writing rsync log to %s...', remoteLogPath);

                gzip.pipe(remoteLog).on('close', function() {
                    winston.info('Saved remote log to %s', remoteLogPath);
                    callback(null, true);
                });

                gzip.end(stdout);
            });
        }
    ],

    getLocalMysqlDirectory: function(callback) {
        var path = backupServicePath + '/mysql';

        fs.exists(path, function(exists) {
            if (exists) {
                callback(null, path);
            } else {
                fs.mkdir(path, '700', function() {
                    callback(null, path);
                });
            }
        });
    },

    getMysqlTables: [
        'getEmergenceConfig',
        function(callback, results) {
            var serviceConfig = results.getEmergenceConfig.services.plugins.sql,
                ignoreSchemas = ['mysql', 'information_schema', 'performance_schema'],
                mysqlCmd = ['mysql'];

            if (config.mysql && config.mysql.ignoreSchemas) {
                winston.info('Ignoring additional mysql schemas:', config.mysql.ignoreSchemas);
                ignoreSchemas.push.apply(ignoreSchemas, config.mysql.ignoreSchemas);
            }

            mysqlCmd.push('-B'); // TSV output
            mysqlCmd.push('-s'); // silent

            mysqlCmd.push('-u', serviceConfig.managerUser);
            mysqlCmd.push('-p' + serviceConfig.managerPassword);
            mysqlCmd.push('-S', '/emergence/services/run/mysqld/mysqld.sock');

            mysqlCmd.push('-e', '"SELECT TABLE_SCHEMA, TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA NOT IN (\''+ignoreSchemas.join('\',\'')+'\')"');

            winston.info("Retrieving mysql tables...");
            child_process.exec(mysqlCmd.join(' '), function(error, stdout, stderr) {
                if (error) {
                    winston.info('There was an error retrieving a list of databases');
                    return callback(error);
                }

                var tables = stdout.trim().split(/\n/).filter(function(line) { return line; }),
                    tablesLength = tables.length,
                    i = 0, tableBits;

                for (; i < tablesLength; i++) {
                    tableBits = tables[i].split(/\t/);

                    tables[i] = {
                        schema: tableBits[0],
                        name: tableBits[1]
                    };
                }

                winston.info('Found %s mysql tables', tablesLength);
                callback(null, tables);
            });
        }
    ],

    dumpMysqlTables: [
        'getToday',
        'getLocalMysqlDirectory',
        'getMysqlTables',
        function(callback, results) {
            var todayPath = results.getLocalMysqlDirectory + '/' + results.getToday,
                serviceConfig = results.getEmergenceConfig.services.plugins.sql,
                ignoreTables = (config.mysql && config.mysql.ignoreTables) || [],
                tablesCount = 0,
                mysqldumpCmd = ['mysqldump'],
                mysqldumpSuffix, schemaPath;

            if (!fs.existsSync(todayPath)) {
                fs.mkdirSync(todayPath, '700');
            }

            winston.info('Dumping mysql to %s...', todayPath);

            mysqldumpCmd.push('--opt');
            mysqldumpCmd.push('--force');
            mysqldumpCmd.push('--single-transaction');
            mysqldumpCmd.push('--quick');

            mysqldumpCmd.push('-u', serviceConfig.managerUser);
            mysqldumpCmd.push('-p' + serviceConfig.managerPassword);
            mysqldumpCmd.push('-S', '/emergence/services/run/mysqld/mysqld.sock');

            async.eachSeries(results.getMysqlTables, function(table, callback) {
                if (
                    ignoreTables.indexOf('*.'+table.name) >= 0 ||
                    ignoreTables.indexOf(table.schema+'.'+table.name) >= 0
                ) {
                    return callback();
                }

                mysqldumpSuffix = [table.schema, table.name];
                mysqldumpSuffix.push('|', 'bzip2');

                schemaPath = todayPath + '/' + table.schema;
                if (!fs.existsSync(schemaPath)) {
                    fs.mkdirSync(schemaPath, '700');
                }

                mysqldumpSuffix.push('>', schemaPath + '/' + table.name + '.sql.bz2');

                child_process.exec(mysqldumpCmd.concat(mysqldumpSuffix).join(' '), callback);
                tablesCount++;
            }, function(error) {
                if (error) {
                    return callback(error);
                }

                winston.info('Dumped %d mysql tables', tablesCount);
            });
        }
    ],

    getRemoteMysqlDirectory: [
        'getRemoteHome',
        function(callback, results) {
            var mysqlRootPath = results.getRemoteHome + '/emergence-services/mysql';

            winston.info('Creating remote directory %s...', mysqlRootPath);
            ssh('mkdir -p ' + mysqlRootPath + '/logs && chmod -R 700 ' + mysqlRootPath, function(error, output, info) {
                if (error) {
                    return callback(error);
                }

                if (info.code != 0) {
                    return callback('Failed to create directory: ' + mysqlRootPath);
                }

                callback(null, mysqlRootPath);
            });
        }
    ],

    uploadMysqlTables: [
        'getToday',
        'getLocalMysqlDirectory',
        'getRemoteMysqlDirectory',
        'dumpMysqlTables',
        function(callback, results) {
            var today = results.getToday,
                remoteLogPath = results.getRemoteMysqlDirectory + '/logs/' + today + '.gz';

            winston.info('Rsyncing SQL backups to server...', {
                src: results.getLocalMysqlDirectory,
                dest: results.getRemoteMysqlDirectory
            });

            rsync({
                host: config.user + '@' + config.host,
                privateKey: privateKeyPath,
                //noExec: true,

                src: results.getLocalMysqlDirectory + '/',
                dest: results.getRemoteMysqlDirectory,

                //dryRun: true,
                recursive: true,

                args: [
                    '-a',
                    '-i',
                    '--chmod=-rwx,u+Xrw'
                ]
            }, function(error, stdout, stderr, cmd) {
                if (error) {
                    return callback(error);
                }

                stdout = (stdout || '').trim();
                winston.info('SQL rsync finished, items changed:', stdout ? stdout.split(/\n/).length : 0);
                winston.verbose('rsync output:\n' + stdout);

                // TODO: don't overwrite existing log if it's an update
                var remoteLog = ssh.put(remoteLogPath),
                    gzip = zlib.createGzip();

                winston.info('Writing rsync log to %s...', remoteLogPath);

                gzip.pipe(remoteLog).on('close', function() {
                    winston.info('Saved remote log to %s', remoteLogPath);
                    callback(null, true);
                });

                gzip.end(stdout);
            });
        }
    ],

    pruneMysqlTables: [
        'getToday',
        'getLocalMysqlDirectory',
        'uploadMysqlTables',
        function(callback, results) {
            winston.warn('TODO: prune mysql tables');
            callback();

            // if (dayNum != '01') {

            //     winston.info("Erasing %s.*-%s.sql.bz2", database, dayNum);
            //         cp.exec('rm '+backupDir+'/'+database+".*-"+dayNum+".sql.bz2", function(error, stdout, stderr) {
            //         if (stderr) {
            //             winston.info(stderr);
            //         }
            //     });
            // }
        }
    ]

}, function(error, results) {
    if (error) {
        winston.error('Backup failed:', error);
    }

    winston.info('Backup complete');
    ssh.end();
});
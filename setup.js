var winston = require('winston'),
    prompt = require('prompt'),
    fs = require('fs'),
    os = require('os'),
    sequest = require('sequest'),
    execSync = require('execSync');

// paths
var backupServicePath = '/emergence/services/backup',
    configPath = backupServicePath + '/config.json',
    privateKeyPath = backupServicePath + '/id_rsa';

// ensure backup service isn't already configured
if (fs.existsSync(backupServicePath)) {
    winston.error(backupServicePath + ' already exists');
    process.exit(1);
}

prompt.start();

prompt.get([{
    name: 'backup_username',
    description: 'Username to create for this host on the backup server',
    required: true,
    default: os.hostname()
},{
    name: 'host',
    description: 'Hostname for backup server',
    required: true
},{
    name: 'username',
    description: 'Superuser username for backup server',
    required: true
},{
    name: 'password',
    description: 'Superuser password for backup server',
    hidden: true
}], function (err, result) {

    winston.info('Creating SSH connection to '+result.host+'...');
    var ssh = sequest.connect(result);

    winston.info('Checking if user exists...');
    ssh('getent passwd ' + result.backup_username + '> /dev/null; echo $?', function(error, output, info) {
        if (error) {
            winston.error('Failed to connect to backup host', error);
            ssh.end();
            process.exit(2);
        }

        if (output.trim() == '0') {
            winston.error('Username "%s" already exists on %s', result.backup_username, result.host);
            ssh.end();
            process.exit(3);
        }

        ssh.end();

        winston.info('Creating ' + backupServicePath + '...');
        fs.mkdirSync(backupServicePath, '700');

        winston.info('Generating ' + privateKeyPath + '...');
        execSync.exec('ssh-keygen -t rsa -N "" -f ' + privateKeyPath);

        winston.info('Writing config to ' + configPath + '...');
        fs.writeFileSync(configPath, JSON.stringify({
            host: result.host,
            mysql: {
                ignoreTables: '*.sessions'
            }
        }, null, 4));

        fs.chmodSync(configPath, '600');
    });
});

/*
var fs = require('fs'),
    async = require('async'),
    rsync = require('rsyncwrapper').rsync;


// configure logger
if (!fs.existsSync('/var/log/emergence-backup')){
    fs.mkdirSync('/var/log/emergence-backup');
}

winston.add(winston.transports.DailyRotateFile, {
    level: 'verbose',
    filename: '/var/log/emergence-backup/log'
});


// load config
winston.info('Loading config...');
var config = JSON.parse(fs.readFileSync('/etc/mrbackup/config.json'));
winston.info('Loaded config:', config);


winston.info('Creating SSH connection...');
var ssh = sequest.connect({
    host: config.host,
    username: config.user,
    privateKey: fs.readFileSync('/etc/mrbackup/id_rsa')
});


winston.info('Executing backup...');

async.auto({
    getHome: function(callback) {
        winston.info('Checking home directory...');
        ssh('echo $HOME', function(error, output, info) {
            var home = output.trim(0);
            winston.info('Remote home directory:', home);
            callback(null, home);
        });
    },
*/

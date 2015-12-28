#!/usr/bin/env node

var winston = require('winston'),
    prompt = require('prompt'),
    fs = require('fs'),
    os = require('os'),
    sequest = require('sequest'),
    execSync = require('execSync'),
    lib = require('./lib');

// paths
var backupServicePath = '/emergence/services/backup',
    configPath = backupServicePath + '/config.json',
    privateKeyPath = backupServicePath + '/id_rsa',
    publicKeyPath = backupServicePath + '/id_rsa.pub';

// error codes
const ERROR_MUST_BE_ROOT = 1,
      ERROR_ALREADY_CONFIGURED = 2,
      ERROR_CANCELLED = 3,
      ERROR_BACKUP_HOST_CONNECTION_FAILED = 4,
      ERROR_BACKUP_HOST_READ_CONFIG_FAILED = 5,
      ERROR_BACKUP_HOST_USER_EXISTS = 6,
      ERROR_WRITE_CRON_FAILED = 7;

// ensure backup service isn't already configured
if (fs.existsSync(backupServicePath)) {
    winston.error(backupServicePath + ' already exists');
    process.exit(ERROR_ALREADY_CONFIGURED);
}

// TODO: use async.auto?

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
}], function (error, result) {
    if (error) {
        winston.error('Prompt failed:', error.message);
        process.exit(1);
    }

    winston.info('Creating SSH connection to '+result.host+'...');
    var ssh = sequest.connect(result);

    winston.info('Reading backup server configuration...');
    ssh('cat /etc/emergence-backup.json || echo ""', function(error, output, info) {
        var serverConfig;

        if (error) {
            winston.error('Failed to connect to backup host', error);
            ssh.end();
            process.exit(2);
        }

        if (!output.trim() || !(serverConfig = JSON.parse(output))) {
            winston.error('Failed to read /etc/emergence-backup.json on backup host', error);
            ssh.end();
            process.exit(3);
        }

        winston.info('serverConfig', serverConfig);

        winston.info('Checking if user exists...');
        ssh('getent passwd ' + result.backup_username + '> /dev/null; echo $?', function(error, output, info) {

            if (output.trim() == '0') {
                winston.error('Username "%s" already exists on %s', result.backup_username, result.host);
                ssh.end();
                process.exit(4);
            }

            winston.info('Creating ' + backupServicePath + '...');
            fs.mkdirSync(backupServicePath, '700');

            winston.info('Generating ' + privateKeyPath + '...');
            execSync.exec('ssh-keygen -t rsa -N "" -f ' + privateKeyPath);

            var username = result.backup_username,
                home = serverConfig.homePrefix + '/' + username,
                setupCmd = [
                    'sudo useradd -m -s /bin/bash -d ' + home + ' ' + username,
                    'sudo mkdir ' + home + '/.ssh',
                    'sudo chmod 700 ' + home + '/.ssh',
                    'echo "' + fs.readFileSync(publicKeyPath) + '" | sudo tee ' + home + '/.ssh/authorized_keys',
                    'sudo chmod 600 ' + home + '/.ssh/authorized_keys',
                    'sudo chown ' + username + ':' + username + ' -R ' + home
                ];

            winston.info('Creating user %s with home %s...', username, home);
            ssh(setupCmd.join(' && '), function(error, output, info) {
                ssh.end();

                winston.info('Writing config to ' + configPath + '...');
                fs.writeFileSync(configPath, JSON.stringify({
                    host: result.host,
                    user: username,
                    mysql: {
                        ignoreTables: '*.sessions'
                    }
                }, null, 4));

                fs.chmodSync(configPath, '600');

                winston.info('Installing cron job...');
                lib.writeCron(null, null, function(error, hour, minute) {
                    if (error) {
                        winston.error('Could not write cron job:', error);
                        process.exit(5);
                    }

                    winston.info('Cron job scheduled for %d:%d', hour, minute);
                });
            });
        });
    });
});
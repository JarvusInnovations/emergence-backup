# emergence-backup Installation

`emergence-backup` runs nightly on the machine you want to backup and uploads snapshots via SSH to a remote disk.

## Prerequisites
- Emergence setup and running on a server (the **backup target**)
- A remote backup server with ample disk space and an SSH login to it with `sudo` access (the **backup server**)

## Initial setup of backup server
If this is the first time you're using a backup server with `emergence-backup`, you'll need to create a configuration file on it that specifies what directory to use for backups. A shell account will be created for each machine being backed up and this directory will serve as the root for their home directories:

### `/etc/emergence-backup.json`
```json
{
	"homePrefix": "/mnt/emergence-backup"
}
```

## Initial setup of backup target
On each machine you want to backup:

1. Install `emergence-backup`:

    `npm install -g git-https://github.com/JarvusInnovations/emergence-backup.git`

2. Complete setup wizard to create account on backup server and install cron job:

    `sudo emergence-backup-setup`

3. Manually trigger initial backup to verify setup:

    `sudo emergence-backup`

Step 2 installed a cron job under `/etc/cron.d/emergence-backup` with a random late night time. Feel free to edit to adjust the time.

# Dashboard display box setup

This document explains how to prepare a mini PC to run JStats and to show the
dashboards on a screen. One machine does all of the work. It runs
Elasticsearch, Kibana, the nightly sync, and the browser that draws the
dashboards.

## What the stack needs

These numbers come from the running stack on 24 September 2026, with the full
data set loaded.

| Item | Measured |
| --- | --- |
| All JStats indexes together | 45.5 MB |
| Elasticsearch memory in use | 1.58 GB, with a 512 MB heap |
| Kibana memory in use | 711 MB |

Minimum hardware: four x86 cores, 8 GB of memory, and a 128 GB solid state
disk. Recommended memory: 16 GB. The extra memory covers the browser, because
the browser runs on the same machine as the stack.

## Before you erase Windows

Capture three things first. You cannot read them after you erase the disk.

### 1. Record the license channel

Open PowerShell as an administrator. Run this command:

```powershell
Get-CimInstance SoftwareLicensingProduct -Filter "Name like 'Windows%' AND PartialProductKey IS NOT NULL" | Select-Object Name, Description, LicenseStatus
```

The `Description` field names the channel. Look for `OEM`, `RETAIL`, or
`VOLUME` inside that text. The channel decides whether the license can move to
another machine. See "Can the Windows license move" below.

### 2. Record the product key

```powershell
(Get-CimInstance SoftwareLicensingService).OA3xOriginalProductKey
```

This command reads the key that the manufacturer wrote into the firmware. An
empty result means that the machine has no firmware key. A retail key or a
volume key gives an empty result here.

### 3. Record the hardware

```powershell
Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, TotalPhysicalMemory
Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores
Get-CimInstance Win32_DiskDrive | Select-Object Model, Size
```

Compare the result against the minimum hardware above.

Copy any files you need off the machine as well. The Linux install erases the
disk.

## Can the Windows license move to another machine

The answer depends on the channel you recorded above. Confirm the result with
the person who manages company licensing before you erase the disk.

OEM channel: no. The manufacturer ties this license to this motherboard. The
license terms do not allow a move to different hardware. When you install
Linux, nothing is lost. The key stays in the firmware. A later Windows install
on this same machine activates itself without a key.

RETAIL channel: yes. Record the key. Then remove the key from this machine
before you erase the disk. Run `slmgr /upk` and then `slmgr /cpky` as an
administrator.

VOLUME channel: there is nothing to move. The company agreement holds the
license, not the machine. Ask the person who manages company licensing to
activate the other machine.

You can still read a firmware key after you install Linux:

```bash
sudo strings /sys/firmware/acpi/tables/MSDM | tail -1
```

## Firmware settings

Enter the firmware setup screen before you install Linux. Set these options.

1. Set the power state after a power cut to "always on". The display box must
   come back by itself.
2. Turn off sleep and hibernation.
3. Turn on boot from USB.
4. Leave Secure Boot on. Ubuntu supports Secure Boot.

## Install Ubuntu

Use Ubuntu Desktop 24.04 LTS. Ubuntu Server has no graphical session, and the
display box needs a browser. Long term support means five years of security
updates.

1. Download the Ubuntu Desktop 24.04 LTS image.
2. Write the image to a USB stick. Use Rufus on the Windows machine, before
   you erase it.
3. Boot the mini PC from the USB stick.
4. Choose the option that erases the disk.
5. Create a user named `jstats`.
6. Turn on automatic login during the install, or turn it on later in Settings
   under Users.

Automatic login matters. Without it, the screen shows a login prompt after
every reboot.

## Network

Connect the machine with an ethernet cable. Wireless works, because the data
set is small and the sync is limited by API quotas rather than by bandwidth.
Wired is steadier for a machine that nobody watches.

Reserve the address on the router, so that the dashboard address never
changes. If you keep wireless, also turn off power saving on the wireless
adapter. Power saving is a common cause of a display box that drops off the
network overnight.

## Install Docker Engine

Do not install Docker Desktop. Docker Engine starts containers at boot without
a logged in user, and it carries no subscription requirement.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker jstats
```

Log out and log in again, so that the new group membership applies.

The JStats scripts call `docker-compose` with a hyphen. Docker Engine provides
`docker compose` with a space. Install the standalone binary so that the
hyphenated name exists:

```bash
sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose version
```

## Bring up the stack

```bash
sudo mkdir -p /opt/jstats /var/log/jstats
sudo chown jstats:jstats /opt/jstats /var/log/jstats
git clone ssh://git@github.com/JeremyRms/JStats.git /opt/jstats
cd /opt/jstats
cp .env.elastic8.example .env.elastic8
```

Edit `.env.elastic8`. Set `ORGANIZATION`, the three passwords, and the Jira
values. Then start the stack:

```bash
ENV_FILE=.env.elastic8 ./scripts/elastic-stack-up.sh
```

Put the GitHub token in `~/.secrets` and the Jira token in `~/.jira/api_token`
on the new machine. The README describes both files.

## Pin the license to basic

A new Elasticsearch cluster starts a 30 day trial license. The trial expired on
this stack on 29 August 2026. Kibana then refused to start, and the only
symptom was a retry loop in the container log. Prevent that failure on the
display box. Add this line to the `es01` service environment in
`elastic-docker-tls.yml`:

```yaml
- xpack.license.self_generated.type=basic
```

The basic license never expires. It includes everything this project uses,
which is transport security, the native user directory, role based access
control, Lens, and dashboards.

If a cluster already runs an expired trial, switch it with one request:

```bash
curl -X POST "https://localhost:9208/_license/start_basic?acknowledge=true" -u elastic:PASSWORD -k
```

## Schedule the nightly sync

A daily sync stays inside the GitHub quota of 5000 requests per hour. A long
catch up does not. The sync on 24 September 2026 covered eight weeks of
backlog, and it used the whole hourly quota after 32 of 128 repositories.

Install the timer:

```bash
sudo cp /opt/jstats/deploy/jstats-sync.service /etc/systemd/system/
sudo cp /opt/jstats/deploy/jstats-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jstats-sync.timer
systemctl list-timers jstats-sync.timer
```

Read the log at `/var/log/jstats/sync.log`.

The stale work dashboard reports staleness against the index, not against
GitHub and Jira. An index that is weeks old makes every document look stale.
A nightly sync keeps that dashboard honest.

## Set up the display

### Create a viewer account

Do not sign the screen in as the `elastic` administrator. Create a read only
account instead. Open Kibana, go to Stack Management, then Users, and create a
user with the built in `viewer` role. Role based access control is part of the
basic license.

### Trust the certificate

The stack uses its own certificate authority. Import the authority file into
the system trust store, so that the browser shows no warning:

```bash
sudo cp /opt/jstats/config/certificates/ca/ca.crt /usr/local/share/ca-certificates/jstats-ca.crt
sudo update-ca-certificates
```

### Start the browser in kiosk mode

When the address carries `embed=true`, Kibana hides its navigation. The
`refreshInterval` value sets the automatic refresh in milliseconds. The example
below refreshes every five minutes.

```bash
chromium --kiosk --noerrdialogs --disable-infobars --password-store=basic "https://localhost:5608/app/dashboards#/view/jstats-stale-work?embed=true&_g=(refreshInterval:(pause:!f,value:300000))"
```

Do not use private browsing mode. The browser must keep the Kibana session
between restarts.

To start the browser at login, create `~/.config/autostart/jstats-kiosk.desktop`
with the command above as the `Exec` line.

The dashboard identifiers are `jstats-stale-work`, `jstats-release-health`,
and `jstats-qa-load`.

## Open items

1. Kibana sessions expire. The exact idle and lifespan defaults for this
   version are not confirmed. If the screen shows a login prompt after a quiet
   period, raise `xpack.security.session.idleTimeout` and
   `xpack.security.session.lifespan` in `kibana.yml`.
2. Anonymous access removes the login from the display altogether. It is not
   confirmed whether the anonymous provider is part of the basic license. Make
   sure that this is true before you plan around it.
3. The scripts call `docker-compose` with a hyphen. The standalone binary above
   solves that. A cleaner fix is to make the scripts accept either name.

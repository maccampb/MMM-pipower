/**
 * node_helper.js — MMM-pipower backend
 *
 * Executes `pipower status` via child_process.exec on request from the
 * frontend module, parses the text output into a structured object, and
 * sends it back via socket notification.
 *
 * `pipower status` is a read-only command and does not require sudo.
 * The MagicMirror process user must be able to execute pipower, which
 * is installed at /usr/local/bin/pipower (on the system PATH).
 *
 * Parsed fields returned in the PIPOWER_STATUS payload:
 *   enabled      {boolean}        — whether the shutdown timer is active
 *   tested       {boolean|string} — true, false, or "pending"
 *   wakeTime     {string}         — "HH:MM TZ" e.g. "06:30 America/Toronto"
 *   sleepTime    {string}         — "HH:MM TZ"
 *   timezone     {string}         — IANA timezone name
 *   nextShutdown {string|null}    — "YYYY-MM-DD HH:MM:SS TZ" or null
 *   rtcAlarm     {string}         — alarm datetime string or "not set"
 *   alarmService {string}         — "active" or other systemd state
 *   version      {string}         — pipower version string e.g. "V2.3"
 */

"use strict";

const NodeHelper = require("node_helper");
const { exec }   = require("child_process");

module.exports = NodeHelper.create({

    /**
     * start() — called when the node helper is initialised.
     * Logs startup confirmation.
     */
    start() {
        console.log("[MMM-pipower] Node helper started");
    },

    /**
     * socketNotificationReceived() — handles requests from the frontend module.
     *
     * GET_STATUS: executes pipower status, parses the output, and sends
     *             PIPOWER_STATUS or PIPOWER_ERROR back to the frontend.
     *
     * @param {string} notification - Notification identifier from frontend.
     * @param {*}      payload      - Payload (unused for GET_STATUS).
     */
    socketNotificationReceived(notification, payload) {
        if (notification === "GET_STATUS") {
            this.fetchStatus();
        }
    },

    /**
     * fetchStatus() — executes `pipower status` and processes the result.
     *
     * Uses a 10-second timeout to avoid blocking if pipower is slow to respond
     * (e.g. during EEPROM check). On success, parses the text output and
     * sends structured data to the frontend. On error, sends PIPOWER_ERROR.
     */
    fetchStatus() {
        const cmd = "pipower status";
        console.log(`[MMM-pipower] Executing: ${cmd}`);

        exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`[MMM-pipower] Exec error: ${error.message}`);
                this.sendSocketNotification(
                    "PIPOWER_ERROR",
                    `Cannot run pipower: ${error.message}`
                );
                return;
            }

            try {
                const data = this.parseStatus(stdout);
                console.log("[MMM-pipower] Parsed status:", JSON.stringify(data));
                this.sendSocketNotification("PIPOWER_STATUS", data);
            } catch (parseError) {
                console.error(`[MMM-pipower] Parse error: ${parseError.message}`);
                this.sendSocketNotification(
                    "PIPOWER_ERROR",
                    `Failed to parse pipower output: ${parseError.message}`
                );
            }
        });
    },

    /**
     * parseStatus() — parses the text output of `pipower status` into a
     * structured JavaScript object.
     *
     * The output format is a series of lines like:
     *   "  Wake time:    06:30 America/Toronto"
     *   "  Enabled:      Yes"
     *   "  Tested:       Yes ✓"
     *   "  Next shutdown:  2026-04-16 22:00:00 EDT"
     *   "  RTC alarm:    not set (set at next shutdown)"
     *   "  Alarm service (pipower-alarm.service): active"
     *
     * Uses regex to extract each field individually for robustness against
     * minor formatting changes. Missing fields return sensible defaults
     * rather than throwing, to keep the display operational during partial
     * output (e.g. if pipower is not yet installed).
     *
     * @param   {string} output - Raw stdout text from `pipower status`.
     * @returns {object}        - Structured status object for the frontend.
     */
    parseStatus(output) {
        /**
         * extract() — helper to pull a value from output using a regex.
         * @param {RegExp} pattern - Must have one capture group.
         * @param {string} [defaultVal=""] - Value if pattern doesn't match.
         * @returns {string}
         */
        const extract = (pattern, defaultVal = "") => {
            const match = output.match(pattern);
            return match ? match[1].trim() : defaultVal;
        };

        // --- Version ---
        const version = extract(/pipower\s+(V[\d.]+)\s+—\s+Status/, "unknown");

        // --- Wake time: "06:30 America/Toronto" ---
        // Capture everything after "Wake time:" on that line
        const wakeRaw    = extract(/Wake time:\s+(.+)/);
        // Timezone is the last space-delimited token of the wake time line
        const timezone   = wakeRaw.split(/\s+/).slice(-1)[0] || "";
        // Wake time is just the HH:MM portion
        const wakeTime   = wakeRaw.split(/\s+/)[0] || wakeRaw;

        // --- Sleep time ---
        const sleepRaw   = extract(/Sleep time:\s+(.+)/);
        const sleepTime  = sleepRaw.split(/\s+/)[0] || sleepRaw;

        // --- Enabled: "Yes" or "No" ---
        const enabledStr = extract(/Enabled:\s+(\S+)/);
        const enabled    = enabledStr.toLowerCase() === "yes";

        // --- Tested: "Yes ✓", "No — ...", or "Pending — ..." ---
        const testedLine = extract(/Tested:\s+(.+)/);
        let tested;
        if (/yes/i.test(testedLine))     tested = true;
        else if (/pending/i.test(testedLine)) tested = "pending";
        else                              tested = false;

        // --- Next shutdown ---
        // pipower status only emits "Next shutdown:" when systemd has computed
        // the next elapse time. Fall back to showing the configured sleep_time
        // when the timer is active but the line is absent (e.g. shortly after boot).
        let nextShutdown = extract(/Next shutdown:\s+(.+)/, null);
        if (!nextShutdown && enabled) {
            nextShutdown = `${sleepTime} (scheduled)`;
        }

        // --- RTC alarm: datetime string or "not set..." ---
        const rtcRaw     = extract(/RTC alarm:\s+(.+)/);
        // If it starts with "not set", normalise to "not set"
        const rtcAlarm   = /^not set/i.test(rtcRaw) ? "not set" : rtcRaw;

        // --- Alarm service state: "active", "inactive", etc. ---
        const alarmService = extract(/Alarm service\s*\([^)]+\):\s+(\S+)/, "unknown");

        return {
            version,
            enabled,
            tested,
            wakeTime,
            sleepTime,
            timezone,
            nextShutdown,
            rtcAlarm,
            alarmService
        };
    }
});

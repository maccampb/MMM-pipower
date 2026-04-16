/**
 * MMM-pipower
 * MagicMirror² module — displays pipower RTC schedule status.
 *
 * Version: V1.0
 * Author:  ckmmconsulting
 *
 * Changelog:
 *   V1.0 - Initial release. Displays wake time, sleep time, enabled state,
 *          tested status, next shutdown, RTC alarm, and timezone. Polls
 *          pipower status every 30 seconds via node_helper shell exec.
 *          Colour-coded status indicators (green/amber/red).
 *
 * Data flow:
 *   1. On start(), send GET_STATUS socket notification to node_helper.
 *   2. node_helper execs `pipower status`, parses output, sends PIPOWER_STATUS.
 *   3. socketNotificationReceived() stores data and calls updateDom().
 *   4. getDom() renders key/value rows with colour-coded indicators.
 *   5. setInterval repeats the GET_STATUS request every updateInterval ms.
 */

Module.register("MMM-pipower", {

    /**
     * Default configuration. All values can be overridden in config.js.
     *
     * @property {number} updateInterval  - Poll interval in milliseconds.
     * @property {boolean} showTimezone   - Include timezone row in display.
     * @property {boolean} showRtcAlarm   - Include RTC alarm row in display.
     * @property {boolean} showTested     - Include tested status row.
     * @property {string} title           - Module header text.
     */
    defaults: {
        updateInterval: 30 * 1000,   // 30 seconds
        showTimezone:   true,
        showRtcAlarm:   true,
        showTested:     true,
        title:          "Pi Power Schedule",
    },

    /**
     * Module state — populated by socketNotificationReceived().
     * null means data has not yet arrived from node_helper.
     */
    pipowerData: null,
    lastUpdated:  null,
    loadError:    null,

    /**
     * start() — called by MagicMirror when the module is initialised.
     * Requests the first status fetch and sets up the polling interval.
     */
    start() {
        Log.info(`[MMM-pipower] Starting — update interval: ${this.config.updateInterval}ms`);
        this.requestUpdate();
        setInterval(() => {
            this.requestUpdate();
        }, this.config.updateInterval);
    },

    /**
     * requestUpdate() — sends a socket notification to node_helper
     * requesting a fresh pipower status fetch.
     */
    requestUpdate() {
        Log.info("[MMM-pipower] Requesting status update");
        this.sendSocketNotification("GET_STATUS");
    },

    /**
     * getHeader() — returns the module header string.
     * @returns {string} Header text from config.
     */
    getHeader() {
        return this.config.title;
    },

    /**
     * getStyles() — returns CSS files to load for this module.
     * @returns {string[]} Array of stylesheet paths relative to module dir.
     */
    getStyles() {
        return ["MMM-pipower.css"];
    },

    /**
     * getDom() — builds and returns the DOM element displayed on the mirror.
     *
     * Renders a table of key/value rows. Status values (Enabled, Tested,
     * Alarm service) are colour-coded:
     *   green  — healthy / active / yes
     *   amber  — warning / pending
     *   red    — inactive / no / error
     *
     * @returns {HTMLElement} Wrapper div containing the status table.
     */
    getDom() {
        const wrapper = document.createElement("div");
        wrapper.className = "pipower-wrapper";

        // Loading state — data not yet received from node_helper
        if (!this.pipowerData && !this.loadError) {
            const loading = document.createElement("div");
            loading.className = "pipower-loading dimmed";
            loading.innerHTML = "Loading pipower status&hellip;";
            wrapper.appendChild(loading);
            return wrapper;
        }

        // Error state — node_helper reported a problem
        if (this.loadError) {
            const err = document.createElement("div");
            err.className = "pipower-error";
            err.innerHTML = `⚠ ${this.loadError}`;
            wrapper.appendChild(err);
            return wrapper;
        }

        const d = this.pipowerData;
        const table = document.createElement("table");
        table.className = "pipower-table small";

        /**
         * addRow() — helper to append a key/value row to the table.
         * @param {string} label      - Left-column label text.
         * @param {string} value      - Right-column value text.
         * @param {string} [cssClass] - Optional CSS class on the value cell.
         */
        const addRow = (label, value, cssClass = "") => {
            const tr = document.createElement("tr");

            const tdLabel = document.createElement("td");
            tdLabel.className = "pipower-label dimmed";
            tdLabel.textContent = label;

            const tdValue = document.createElement("td");
            tdValue.className = `pipower-value ${cssClass}`;
            tdValue.textContent = value;

            tr.appendChild(tdLabel);
            tr.appendChild(tdValue);
            table.appendChild(tr);
        };

        // Enabled — green if yes, red if no
        const enabledClass = d.enabled ? "pipower-green" : "pipower-red";
        addRow("Enabled", d.enabled ? "Yes" : "No", enabledClass);

        // Tested — green if yes, amber if pending, red if no
        let testedClass = "pipower-red";
        if (d.tested === true)       testedClass = "pipower-green";
        else if (d.tested === "pending") testedClass = "pipower-amber";
        if (this.config.showTested) {
            const testedLabel = d.tested === true
                ? "Yes ✓"
                : d.tested === "pending"
                    ? "Pending…"
                    : "No";
            addRow("Tested", testedLabel, testedClass);
        }

        // Schedule
        addRow("Wake", d.wakeTime || "—");
        addRow("Sleep", d.sleepTime || "—");

        // Timezone
        if (this.config.showTimezone) {
            addRow("Timezone", d.timezone || "—", "dimmed");
        }

        // Next scheduled shutdown — amber if set, dimmed if not
        if (d.nextShutdown) {
            addRow("Next shutdown", d.nextShutdown, "pipower-amber");
        } else {
            addRow("Next shutdown", "Not scheduled", "dimmed");
        }

        // RTC alarm — green if set (alarm is armed), dimmed if not set
        if (this.config.showRtcAlarm) {
            if (d.rtcAlarm && d.rtcAlarm !== "not set") {
                addRow("RTC alarm", d.rtcAlarm, "pipower-green");
            } else {
                addRow("RTC alarm", "Not set", "dimmed");
            }
        }

        // Alarm service state — green if active, red otherwise
        const svcClass = d.alarmService === "active" ? "pipower-green" : "pipower-red";
        addRow("Alarm service", d.alarmService || "unknown", svcClass);

        wrapper.appendChild(table);

        // Last updated timestamp — subtle, bottom of widget
        if (this.lastUpdated) {
            const updated = document.createElement("div");
            updated.className = "pipower-updated xsmall dimmed";
            updated.textContent = `Updated: ${this.lastUpdated}`;
            wrapper.appendChild(updated);
        }

        return wrapper;
    },

    /**
     * socketNotificationReceived() — receives messages from node_helper.
     *
     * Handles two notification types:
     *   PIPOWER_STATUS — successful fetch; stores parsed data and re-renders.
     *   PIPOWER_ERROR  — fetch or parse failed; stores error message and re-renders.
     *
     * @param {string} notification - Notification identifier.
     * @param {*}      payload      - Data payload from node_helper.
     */
    socketNotificationReceived(notification, payload) {
        if (notification === "PIPOWER_STATUS") {
            Log.info("[MMM-pipower] Status received:", payload);
            this.pipowerData = payload;
            this.loadError   = null;
            // Record the local time of the last successful update
            this.lastUpdated = new Date().toLocaleTimeString();
            this.updateDom();
        } else if (notification === "PIPOWER_ERROR") {
            Log.error("[MMM-pipower] Error from node_helper:", payload);
            this.loadError = payload;
            this.updateDom();
        }
    }
});

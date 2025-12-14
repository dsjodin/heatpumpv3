/**
 * WebSocket Client for Heat Pump Dashboard
 * Handles all real-time communication with Flask backend
 */

// Global state
let currentTimeRange = '24h';
let connected = false;

// Connect to WebSocket server
console.log('Initializing Socket.IO client...');
const socket = io(window.location.origin, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
    timeout: 10000
});

// ==================== Connection Event Handlers ====================

socket.on('connect', () => {
    console.log('✅ WebSocket connected');
    connected = true;
    updateConnectionStatus(true);

    // Load initial data via HTTP (faster for bulk data)
    loadInitialData(currentTimeRange);
});

socket.on('disconnect', () => {
    console.log('❌ WebSocket disconnected');
    connected = false;
    updateConnectionStatus(false);
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    updateConnectionStatus(false);
});

socket.on('connection_status', (data) => {
    console.log('📡', data.message);
});

// ==================== Data Update Handlers ====================

socket.on('graph_update', (data) => {
    console.log('📊 Received graph update');

    // Update all charts with new data
    if (window.updateAllCharts) {
        window.updateAllCharts(data);
    }

    // Update KPI cards
    if (window.updateKPIs) {
        window.updateKPIs(data);
    }

    // Update alarm status
    if (data.status) {
        updateAlarmStatus(data.status);
    }

    // Update event log
    if (data.events) {
        updateEventLog(data.events);
    }

    // Update all new UI elements
    updateTopbarQuickStats(data);
    updateStatusBadges(data);
    updateSecondaryTemps(data);
    updateHotWaterSection(data);
    updateSchemaTemps(data);

    // Update last update time
    updateLastUpdateTime();
});

socket.on('error', (data) => {
    console.error('❌ Server error:', data.message);
    showError(data.message);
});

// ==================== HTTP Data Loading ====================

async function loadInitialData(timeRange) {
    try {
        console.log(`📥 Loading initial data for range: ${timeRange}`);

        const response = await fetch(`/api/initial-data?range=${timeRange}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ Initial data loaded', data);

        // Initialize charts with data
        if (window.initializeCharts) {
            window.initializeCharts(data);
        }

        // Update KPIs
        if (window.updateKPIs) {
            window.updateKPIs(data);
        }

        // Update alarm status
        if (data.status) {
            updateAlarmStatus(data.status);
        }

        // Update event log
        if (data.events) {
            updateEventLog(data.events);
        }

        // Update all new UI elements
        updateTopbarQuickStats(data);
        updateStatusBadges(data);
        updateSecondaryTemps(data);
        updateHotWaterSection(data);
        updateSchemaTemps(data);

        updateLastUpdateTime();

    } catch (error) {
        console.error('❌ Failed to load initial data:', error);
        showError('Failed to load dashboard data. Please refresh the page.');
    }
}

// ==================== User Interface Updates ====================

function updateConnectionStatus(isConnected) {
    const badge = document.getElementById('connection-status');
    if (isConnected) {
        badge.className = 'badge connection-badge connected';
        badge.textContent = 'Ansluten';
    } else {
        badge.className = 'badge connection-badge disconnected';
        badge.textContent = 'Frånkopplad';
    }
}

function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('sv-SE');
    document.getElementById('last-update').textContent = `Uppdaterad: ${timeString}`;
}

function showError(message) {
    // Simple error display (could be enhanced with toast notifications)
    console.error('Error:', message);
    // Could add a toast notification here
}

// ==================== User Interaction Handlers ====================

// Time range change
document.addEventListener('DOMContentLoaded', () => {
    const timeRangeSelect = document.getElementById('time-range');
    if (timeRangeSelect) {
        timeRangeSelect.addEventListener('change', (event) => {
            currentTimeRange = event.target.value;
            console.log(`🔄 Time range changed to: ${currentTimeRange}`);

            if (connected) {
                // Request new data via WebSocket
                socket.emit('change_time_range', { range: currentTimeRange });
            } else {
                // Fallback to HTTP if not connected
                loadInitialData(currentTimeRange);
            }
        });
    }

    // Manual refresh button
    const refreshButton = document.getElementById('btn-refresh');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            console.log('🔄 Manual refresh requested');

            if (connected) {
                socket.emit('request_update', { range: currentTimeRange });
            } else {
                loadInitialData(currentTimeRange);
            }
        });
    }

    // Price input change - update KPI calculations
    const priceInput = document.getElementById('price-input');
    if (priceInput) {
        priceInput.addEventListener('change', () => {
            console.log(`💰 Price changed to: ${priceInput.value} kr/kWh`);
            // Trigger a manual refresh to recalculate with new price
            if (connected) {
                socket.emit('request_update', { range: currentTimeRange, price: parseFloat(priceInput.value) });
            } else {
                loadInitialData(currentTimeRange);
            }
        });
    }
});

// ==================== Status Update Functions ====================

function updateAlarmStatus(status) {
    const alarmCard = document.getElementById('alarm-card');
    const alarmContent = document.getElementById('alarm-content');

    if (!status || !status.alarm) {
        return;
    }

    const alarm = status.alarm;

    if (alarm.is_active) {
        // ALARM ACTIVE
        alarmCard.className = 'chart-card alarm-active';

        let alarmTime = 'Okänd';
        let duration = '';

        if (alarm.time) {
            try {
                const alarmDate = new Date(alarm.time);
                alarmTime = alarmDate.toLocaleString('sv-SE');

                const now = new Date();
                const durationMs = now - alarmDate;
                const hours = Math.floor(durationMs / (1000 * 60 * 60));
                const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

                if (hours > 0) {
                    duration = `${hours}h ${minutes}min`;
                } else {
                    duration = `${minutes}min`;
                }
            } catch (e) {
                console.error('Error parsing alarm time:', e);
            }
        }

        alarmContent.innerHTML = `
            <div class="text-center alarm-icon">
                <i class="fas fa-exclamation-circle"></i>
            </div>
            <h4 class="text-danger text-center mb-3">⚠️ LARM AKTIVT!</h4>
            <div class="alarm-description mb-2">
                <strong>Larmkod ${alarm.code || 'N/A'}: </strong>
                <span>${alarm.description || 'Okänd beskrivning'}</span>
            </div>
            <hr>
            <div class="alarm-details">
                <div class="mb-2">
                    <i class="fas fa-clock me-2"></i>
                    <strong>Aktiverad: </strong>
                    <span>${alarmTime}</span>
                </div>
                ${duration ? `
                <div>
                    <i class="fas fa-hourglass-half me-2"></i>
                    <strong>Varaktighet: </strong>
                    <span>${duration}</span>
                </div>
                ` : ''}
            </div>
            <hr>
            <div class="mt-3">
                <i class="fas fa-info-circle me-2"></i>
                <span class="text-muted">Kontrollera värmepumpen och återställ larmet efter åtgärd.</span>
            </div>
        `;
    } else {
        // NO ALARM
        alarmCard.className = 'chart-card alarm-ok';
        alarmContent.innerHTML = `
            <div class="text-center alarm-icon">
                <i class="fas fa-check-circle"></i>
            </div>
            <h5 class="text-success text-center mb-2">✅ Inget aktivt larm</h5>
            <p class="text-muted text-center mb-0">Systemet fungerar normalt</p>
        `;
    }
}

function updateEventLog(events) {
    const eventLog = document.getElementById('event-log');

    if (!events || events.length === 0) {
        eventLog.innerHTML = '<div class="text-center text-muted p-3">Inga händelser att visa</div>';
        return;
    }

    let html = '';
    events.forEach(event => {
        const eventType = event.type || 'info';
        let eventTime = 'Okänd tid';

        try {
            if (event.time) {
                const date = new Date(event.time);
                eventTime = date.toLocaleString('sv-SE', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (e) {
            console.error('Error parsing event time:', e);
        }

        const icon = event.icon || '';
        const description = event.description || 'No description';

        html += `
            <div class="event-item">
                <div class="d-flex justify-content-between align-items-start">
                    <span class="event-time">${eventTime}</span>
                    <span class="event-type ${eventType}">${eventType}</span>
                </div>
                <div class="event-description">${icon} ${description}</div>
                ${event.value ? `<div class="event-value">Värde: ${event.value}</div>` : ''}
            </div>
        `;
    });

    eventLog.innerHTML = html;
}

function updateTopbarQuickStats(data) {
    if (!data.status || !data.status.current) return;

    const current = data.status.current;

    // Update topbar temperatures
    if (current.outdoor_temp && current.outdoor_temp.current !== null) {
        document.getElementById('topbar-outdoor').textContent = `${current.outdoor_temp.current.toFixed(1)}°C`;
    }
    if (current.indoor_temp && current.indoor_temp.current !== null) {
        document.getElementById('topbar-indoor').textContent = `${current.indoor_temp.current.toFixed(1)}°C`;
    }
    if (current.hot_water && current.hot_water.current !== null) {
        document.getElementById('topbar-hotwater').textContent = `${current.hot_water.current.toFixed(0)}°C`;
    }

    // Update COP
    const topbarCop = document.getElementById('topbar-cop');
    if (current.current_cop !== null && current.current_cop !== undefined && !isNaN(current.current_cop)) {
        topbarCop.textContent = current.current_cop.toFixed(2);
    } else {
        topbarCop.textContent = '--';
    }

    // Update power
    if (current.power !== null) {
        document.getElementById('topbar-power').textContent = `${current.power} W`;
    }

    // Update status
    const statusIcon = document.getElementById('topbar-status-icon');
    const statusText = document.getElementById('topbar-status');

    if (data.status.alarm && data.status.alarm.is_active) {
        statusIcon.className = 'fas fa-exclamation-triangle me-2 topbar-icon text-danger';
        statusText.textContent = 'LARM!';
        statusText.className = 'topbar-value text-danger fw-bold';
    } else if (current.compressor_running) {
        statusIcon.className = 'fas fa-cog fa-spin me-2 topbar-icon text-success';
        statusText.textContent = 'Kompressor PÅ';
        statusText.className = 'topbar-value text-success';
    } else {
        statusIcon.className = 'fas fa-check-circle me-2 topbar-icon';
        statusText.textContent = 'Standby';
        statusText.className = 'topbar-value';
    }
}

function updateStatusBadges(data) {
    if (!data.status || !data.status.current) return;

    const current = data.status.current;

    // Compressor status
    const compBadge = document.getElementById('status-compressor');
    const compText = document.getElementById('status-comp-text');
    if (current.compressor_running) {
        compBadge.className = 'badge status-badge status-badge-topbar status-on';
        compText.textContent = 'PÅ';
    } else {
        compBadge.className = 'badge status-badge status-badge-topbar status-off';
        compText.textContent = 'AV';
    }

    // Brine pump status
    const brinePumpBadge = document.getElementById('status-brine-pump');
    const brinePumpText = document.getElementById('status-brine-text');
    if (current.brine_pump_running) {
        brinePumpBadge.className = 'badge status-badge status-badge-topbar status-on';
        brinePumpText.textContent = 'PÅ';
    } else {
        brinePumpBadge.className = 'badge status-badge status-badge-topbar status-off';
        brinePumpText.textContent = 'AV';
    }

    // Radiator pump status
    const radPumpBadge = document.getElementById('status-radiator-pump');
    const radPumpText = document.getElementById('status-rad-text');
    if (current.radiator_pump_running) {
        radPumpBadge.className = 'badge status-badge status-badge-topbar status-on';
        radPumpText.textContent = 'PÅ';
    } else {
        radPumpBadge.className = 'badge status-badge status-badge-topbar status-off';
        radPumpText.textContent = 'AV';
    }

    // Aux heater status
    const auxBadge = document.getElementById('status-aux');
    const auxText = document.getElementById('status-aux-text');
    if (current.aux_heater) {
        auxBadge.className = 'badge status-badge status-badge-topbar status-on';
        auxText.textContent = 'PÅ';
    } else {
        auxBadge.className = 'badge status-badge status-badge-topbar status-off';
        auxText.textContent = 'AV';
    }

    // Valve status (0=Radiator, 1=Hot Water)
    const valveBadge = document.getElementById('status-valve');
    const valveText = document.getElementById('status-valve-text');
    if (current.switch_valve_status !== undefined) {
        valveBadge.className = 'badge status-badge status-badge-topbar status-on';
        if (current.switch_valve_status === 0) {
            valveText.textContent = 'Radiator';
        } else {
            valveText.textContent = 'Varmvatten';
        }
    } else {
        valveBadge.className = 'badge status-badge status-badge-topbar';
        valveText.textContent = '--';
    }

    // Alarm status
    const alarmBadge = document.getElementById('status-alarm-badge');
    const alarmText = document.getElementById('status-alarm-text');
    if (data.status.alarm && data.status.alarm.is_active) {
        alarmBadge.className = 'badge status-badge status-badge-topbar status-alarm';
        alarmText.textContent = 'Aktivt!';
    } else {
        alarmBadge.className = 'badge status-badge status-badge-topbar status-off';
        alarmText.textContent = 'Inget';
    }
}

function updateSecondaryTemps(data) {
    if (!data.status || !data.status.current) return;

    const current = data.status.current;

    // Helper to update temp card
    function updateTempCard(id, tempData) {
        if (!tempData) return;

        const tempEl = document.getElementById(`${id}-temp`);
        const minmaxEl = document.getElementById(`${id}-minmax`);

        if (tempData.current !== null) {
            tempEl.textContent = `${tempData.current.toFixed(1)}°C`;
        }

        if (tempData.min !== null && tempData.max !== null) {
            const avgText = tempData.avg !== null ? ` | Snitt: ${tempData.avg.toFixed(1)}°C` : '';
            minmaxEl.textContent = `Min: ${tempData.min.toFixed(1)}°C | Max: ${tempData.max.toFixed(1)}°C${avgText}`;
        }
    }

    updateTempCard('brine-in', current.brine_in);
    updateTempCard('brine-out', current.brine_out);
    updateTempCard('radiator-forward', current.radiator_forward);
    updateTempCard('radiator-return', current.radiator_return);
}

function updateHotWaterSection(data) {
    if (!data.kpi || !data.kpi.hot_water) return;

    const hw = data.kpi.hot_water;

    document.getElementById('hw-total-cycles').textContent = hw.total_cycles;
    document.getElementById('hw-cycles-per-day').textContent = hw.cycles_per_day.toFixed(1);
    document.getElementById('hw-avg-duration').textContent = `${hw.avg_duration_minutes.toFixed(0)} min`;
    document.getElementById('hw-avg-energy').textContent = `${hw.avg_energy_kwh.toFixed(1)} kWh`;
}

function updateSchemaTemps(data) {
    if (!data.status || !data.status.current) return;

    const current = data.status.current;

    // Get the brand from the schema container data attribute
    const schemaContainer = document.getElementById('schema-container');
    const brand = schemaContainer ? schemaContainer.dataset.brand : 'thermia';

    // Helper function to toggle active class on overlay elements
    function setOverlayActive(elementId, isActive) {
        const element = document.getElementById(elementId);
        if (element) {
            if (isActive) {
                element.classList.add('active');
            } else {
                element.classList.remove('active');
            }
        }
    }

    // ==================== Update Temperature Text Displays ====================

    // Outdoor temperature
    const textOutdoor = document.getElementById('text-outdoor_temp');
    if (textOutdoor && current.outdoor_temp && current.outdoor_temp.current !== null) {
        textOutdoor.textContent = `${current.outdoor_temp.current.toFixed(1)}°C`;
    }

    // Hotgas temperature (if available)
    const textHotgas = document.getElementById('text-hotgas_temp');
    if (textHotgas && current.hotgas_temp !== undefined && current.hotgas_temp !== null) {
        textHotgas.textContent = `${current.hotgas_temp.toFixed(1)}°C`;
    } else if (textHotgas && current.condenser_temp !== undefined && current.condenser_temp !== null) {
        // Fallback to condenser temp if hotgas not available
        textHotgas.textContent = `${current.condenser_temp.toFixed(1)}°C`;
    }

    // Integral value (Thermia only)
    const textIntegral = document.getElementById('text-integral_value');
    if (textIntegral && current.integral_value !== undefined && current.integral_value !== null) {
        textIntegral.textContent = current.integral_value.toFixed(0);
    }

    // KB in temperature (brine in)
    const textKBIn = document.getElementById('text-KB_in_temp');
    if (textKBIn && current.brine_in && current.brine_in.current !== null) {
        textKBIn.textContent = `${current.brine_in.current.toFixed(1)}°C`;
    }

    // KB out temperature (brine out)
    const textKBOut = document.getElementById('text-KB_out_temp');
    if (textKBOut && current.brine_out && current.brine_out.current !== null) {
        textKBOut.textContent = `${current.brine_out.current.toFixed(1)}°C`;
    }

    // Hotwater temperature
    const textHotwater = document.getElementById('text-hotwater_temp');
    if (textHotwater && current.hot_water && current.hot_water.current !== null) {
        textHotwater.textContent = `${current.hot_water.current.toFixed(1)}°C`;
    }

    // Radiator forward temperature
    const textRadForward = document.getElementById('text-radiator_forward_temp');
    if (textRadForward && current.radiator_forward && current.radiator_forward.current !== null) {
        textRadForward.textContent = `${current.radiator_forward.current.toFixed(1)}°C`;
    }

    // Radiator return temperature
    const textRadReturn = document.getElementById('text-radiator_return_temp');
    if (textRadReturn && current.radiator_return && current.radiator_return.current !== null) {
        textRadReturn.textContent = `${current.radiator_return.current.toFixed(1)}°C`;
    }

    // ==================== Update Overlay Animations ====================

    // Compressor animation - show when compressor is running
    setOverlayActive('overlay-BV_komp_anim', current.compressor_running === true);

    // 3kW heater indicator - show when aux heater is on
    setOverlayActive('overlay-3kw_on', current.aux_heater === true);

    // Brine pump (KB) spinning - show when brine pump is running
    setOverlayActive('overlay-KB_snurr', current.brine_pump_running === true);

    // Radiator pump spinning - show when radiator pump is running
    setOverlayActive('overlay-RAD_snurr', current.radiator_pump_running === true);

    // Radiator arrow - show when valve is in radiator position (0)
    setOverlayActive('overlay-RAD_pil', current.switch_valve_status === 0);

    // Radiator hot indicator - show when valve is in radiator mode (0) OR radiator forward temp > 32°C
    const showRadHot = current.switch_valve_status === 0 ||
                       (current.radiator_forward &&
                        current.radiator_forward.current !== null &&
                        current.radiator_forward.current > 32);
    setOverlayActive('overlay-RAD_hot', showRadHot);

    // Hot water indicator - show when valve is in hot water position (växelventil = varmvattenläge)
    const showVVHot = current.switch_valve_status !== undefined &&
                      current.switch_valve_status !== null &&
                      current.switch_valve_status > 0;
    setOverlayActive('overlay-VV_hot', showVVHot);

    // IVT only: VB pump spinning - show when radiator pump running AND in hot water mode
    if (brand === 'ivt') {
        const showVBPump = current.radiator_pump_running === true && current.switch_valve_status > 0;
        setOverlayActive('overlay-VB_snurr', showVBPump);
    }
}

// ==================== Helper Functions ====================

// Make socket available globally if needed
window.dashboardSocket = socket;

console.log('🚀 Socket client initialized');

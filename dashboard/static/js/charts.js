/**
 * Charts for Heat Pump Dashboard - Analys View
 * Single main chart with overlay toggle support
 */

// Global state
let mainChart = null;
let currentChartType = 'temperature';
let chartData = null;

// Chart colors
const COLORS = {
    radiator_forward: '#ff6b6b',
    radiator_return: '#feca57',
    hot_water_top: '#ff9ff3',
    brine_in_evaporator: '#54a0ff',
    brine_out_condenser: '#00d2d3',
    outdoor_temp: '#5f27cd',
    pressure_tube_temp: '#ee5a24',
    indoor_temp: '#10ac84',
    power: '#f39c12',
    cop: '#27ae60',
    compressor_overlay: 'rgba(52, 152, 219, 0.15)',
    valve_overlay: 'rgba(155, 89, 182, 0.3)',
    aux_overlay: 'rgba(231, 76, 60, 0.2)'
};

// Series names in Swedish
const SERIES_NAMES = {
    radiator_forward: 'Fram',
    radiator_return: 'Retur',
    hot_water_top: 'Varmvatten',
    brine_in_evaporator: 'KB In',
    brine_out_condenser: 'KB Ut',
    outdoor_temp: 'Ute',
    pressure_tube_temp: 'Hetgas',
    indoor_temp: 'Inne',
    power_consumption: 'Effekt',
    cop: 'COP'
};

// ==================== Initialize Chart ====================

function initMainChart() {
    const container = document.getElementById('main-chart');
    if (!container) return;

    mainChart = echarts.init(container);

    // Handle resize
    window.addEventListener('resize', () => {
        if (mainChart) mainChart.resize();
    });

    console.log('📊 Main chart initialized');
}

// ==================== Update Chart ====================

function updateMainChart(data) {
    if (!mainChart) initMainChart();
    if (!data) return;

    chartData = data;

    switch (currentChartType) {
        case 'temperature':
            renderTemperatureChart(data);
            break;
        case 'power':
            renderPowerChart(data);
            break;
        case 'cop':
            renderCOPChart(data);
            break;
        case 'energy':
            renderEnergyChart(data);
            break;
        default:
            renderTemperatureChart(data);
    }
}

// ==================== Temperature Chart ====================

function renderTemperatureChart(data) {
    if (!data.temperature || !data.temperature.timestamps) return;

    const timestamps = data.temperature.timestamps.map(t => new Date(t));
    const series = [];

    // Get visible series from checkboxes
    const visibleSeries = getVisibleSeries();

    // Temperature series
    const tempMetrics = [
        'radiator_forward', 'radiator_return', 'hot_water_top',
        'brine_in_evaporator', 'brine_out_condenser', 'outdoor_temp', 'pressure_tube_temp'
    ];

    tempMetrics.forEach(metric => {
        if (data.temperature[metric] && visibleSeries.includes(metric)) {
            series.push({
                name: SERIES_NAMES[metric] || metric,
                type: 'line',
                data: data.temperature[metric],
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 2, color: COLORS[metric] },
                itemStyle: { color: COLORS[metric] }
            });
        }
    });

    // Add overlay bands (compressor, valve, aux)
    const markAreas = buildOverlayMarkAreas(data, timestamps);

    if (series.length > 0 && markAreas.length > 0) {
        series[0].markArea = {
            silent: true,
            data: markAreas
        };
    }

    const option = {
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(p => {
                    if (p.value !== null && p.value !== undefined) {
                        result += `${p.marker} ${p.seriesName}: ${p.value.toFixed(1)}°C<br/>`;
                    }
                });
                return result;
            }
        },
        legend: {
            data: series.map(s => s.name),
            bottom: 0,
            type: 'scroll'
        },
        grid: {
            left: 50,
            right: 20,
            top: 20,
            bottom: 50
        },
        xAxis: {
            type: 'category',
            data: timestamps,
            axisLabel: {
                formatter: (value) => {
                    const d = new Date(value);
                    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                }
            }
        },
        yAxis: {
            type: 'value',
            name: '°C',
            axisLabel: { formatter: '{value}°C' }
        },
        series: series,
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 20, bottom: 25 }
        ]
    };

    mainChart.setOption(option, true);
    updateChartTitle('temperature');
}

// ==================== Power Chart ====================

function renderPowerChart(data) {
    if (!data.power || !data.power.timestamps) return;

    const timestamps = data.power.timestamps.map(t => new Date(t));
    const series = [];

    if (data.power.power_consumption) {
        series.push({
            name: 'Effekt',
            type: 'line',
            data: data.power.power_consumption,
            smooth: true,
            symbol: 'none',
            areaStyle: { opacity: 0.3 },
            lineStyle: { width: 2, color: COLORS.power },
            itemStyle: { color: COLORS.power }
        });
    }

    // Add overlay bands
    const markAreas = buildOverlayMarkAreas(data, timestamps);
    if (series.length > 0 && markAreas.length > 0) {
        series[0].markArea = { silent: true, data: markAreas };
    }

    const option = {
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(p => {
                    if (p.value !== null && p.value !== undefined) {
                        result += `${p.marker} ${p.seriesName}: ${p.value.toFixed(0)} W<br/>`;
                    }
                });
                return result;
            }
        },
        grid: { left: 60, right: 20, top: 20, bottom: 50 },
        xAxis: {
            type: 'category',
            data: timestamps,
            axisLabel: {
                formatter: (value) => {
                    const d = new Date(value);
                    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                }
            }
        },
        yAxis: {
            type: 'value',
            name: 'W',
            axisLabel: { formatter: '{value} W' }
        },
        series: series,
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 20, bottom: 25 }
        ]
    };

    mainChart.setOption(option, true);
    updateChartTitle('power');
}

// ==================== COP Chart ====================

function renderCOPChart(data) {
    if (!data.cop || !data.cop.timestamps) return;

    const timestamps = data.cop.timestamps.map(t => new Date(t));
    const series = [];

    if (data.cop.cop) {
        series.push({
            name: 'COP',
            type: 'line',
            data: data.cop.cop,
            smooth: true,
            symbol: 'none',
            lineStyle: { width: 3, color: COLORS.cop },
            itemStyle: { color: COLORS.cop }
        });
    }

    // Add overlay bands
    const markAreas = buildOverlayMarkAreas(data, timestamps);
    if (series.length > 0 && markAreas.length > 0) {
        series[0].markArea = { silent: true, data: markAreas };
    }

    const option = {
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(p => {
                    if (p.value !== null && p.value !== undefined) {
                        result += `${p.marker} ${p.seriesName}: ${p.value.toFixed(2)}<br/>`;
                    }
                });
                return result;
            }
        },
        grid: { left: 50, right: 20, top: 20, bottom: 50 },
        xAxis: {
            type: 'category',
            data: timestamps,
            axisLabel: {
                formatter: (value) => {
                    const d = new Date(value);
                    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
                }
            }
        },
        yAxis: {
            type: 'value',
            name: 'COP',
            min: 0,
            max: 6
        },
        series: series,
        dataZoom: [
            { type: 'inside', start: 0, end: 100 },
            { type: 'slider', start: 0, end: 100, height: 20, bottom: 25 }
        ]
    };

    mainChart.setOption(option, true);
    updateChartTitle('cop');
}

// ==================== Energy Sankey Chart ====================

function renderEnergyChart(data) {
    // Simple energy flow visualization
    const kpi = data.kpi || {};
    const energy = kpi.energy || {};
    const runtime = kpi.runtime || {};

    const totalEnergy = energy.total_kwh || 0;
    const compPercent = runtime.compressor_runtime_percent || 0;
    const auxPercent = runtime.aux_heater_runtime_percent || 0;

    // Estimate energy split (simplified)
    const compEnergy = totalEnergy * (compPercent / 100) * 0.8;
    const auxEnergy = totalEnergy * (auxPercent / 100) * 0.2;
    const standbyEnergy = totalEnergy - compEnergy - auxEnergy;

    const option = {
        tooltip: { trigger: 'item' },
        series: [{
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: {
                borderRadius: 10,
                borderColor: '#fff',
                borderWidth: 2
            },
            label: {
                show: true,
                formatter: '{b}: {d}%'
            },
            data: [
                { value: compEnergy.toFixed(1), name: 'Kompressor', itemStyle: { color: '#3498db' } },
                { value: auxEnergy.toFixed(1), name: 'Tillsats', itemStyle: { color: '#e74c3c' } },
                { value: standbyEnergy.toFixed(1), name: 'Standby', itemStyle: { color: '#95a5a6' } }
            ]
        }]
    };

    mainChart.setOption(option, true);
    updateChartTitle('energy');
}

// ==================== Overlay Mark Areas ====================

function buildOverlayMarkAreas(data, timestamps) {
    const markAreas = [];

    const showCompressor = document.getElementById('overlay-compressor')?.checked;
    const showValve = document.getElementById('overlay-valve')?.checked;
    const showAux = document.getElementById('overlay-aux')?.checked;

    // Get valve data for overlays
    if (data.valve && data.valve.timestamps && data.valve.compressor_status) {
        const valveTimestamps = data.valve.timestamps;
        const compressorStatus = data.valve.compressor_status;
        const valveStatus = data.valve.switch_valve_status;
        const auxStatus = data.valve.additional_heat_percent;

        // Find ON periods for compressor
        if (showCompressor && compressorStatus) {
            let startIdx = null;
            for (let i = 0; i < compressorStatus.length; i++) {
                if (compressorStatus[i] === 1 && startIdx === null) {
                    startIdx = i;
                } else if (compressorStatus[i] === 0 && startIdx !== null) {
                    markAreas.push([
                        { xAxis: valveTimestamps[startIdx], itemStyle: { color: COLORS.compressor_overlay } },
                        { xAxis: valveTimestamps[i - 1] }
                    ]);
                    startIdx = null;
                }
            }
            if (startIdx !== null) {
                markAreas.push([
                    { xAxis: valveTimestamps[startIdx], itemStyle: { color: COLORS.compressor_overlay } },
                    { xAxis: valveTimestamps[valveTimestamps.length - 1] }
                ]);
            }
        }

        // Find hot water periods (valve status = 1)
        if (showValve && valveStatus) {
            let startIdx = null;
            for (let i = 0; i < valveStatus.length; i++) {
                if (valveStatus[i] === 1 && startIdx === null) {
                    startIdx = i;
                } else if (valveStatus[i] === 0 && startIdx !== null) {
                    markAreas.push([
                        { xAxis: valveTimestamps[startIdx], itemStyle: { color: COLORS.valve_overlay } },
                        { xAxis: valveTimestamps[i - 1] }
                    ]);
                    startIdx = null;
                }
            }
            if (startIdx !== null) {
                markAreas.push([
                    { xAxis: valveTimestamps[startIdx], itemStyle: { color: COLORS.valve_overlay } },
                    { xAxis: valveTimestamps[valveTimestamps.length - 1] }
                ]);
            }
        }

        // Find aux heater periods
        if (showAux && auxStatus) {
            let startIdx = null;
            for (let i = 0; i < auxStatus.length; i++) {
                if (auxStatus[i] > 0 && startIdx === null) {
                    startIdx = i;
                } else if (auxStatus[i] === 0 && startIdx !== null) {
                    markAreas.push([
                        { xAxis: valveTimestamps[startIdx], itemStyle: { color: COLORS.aux_overlay } },
                        { xAxis: valveTimestamps[i - 1] }
                    ]);
                    startIdx = null;
                }
            }
            if (startIdx !== null) {
                markAreas.push([
                    { xAxis: valveTimestamps[startIdx], itemStyle: { color: COLORS.aux_overlay } },
                    { xAxis: valveTimestamps[auxStatus.length - 1] }
                ]);
            }
        }
    }

    return markAreas;
}

// ==================== Helper Functions ====================

function getVisibleSeries() {
    const visible = [];
    document.querySelectorAll('.series-toggle:checked').forEach(toggle => {
        visible.push(toggle.dataset.series);
    });
    return visible;
}

function updateChartTitle(chartType) {
    const titleEl = document.getElementById('chart-title');
    if (!titleEl) return;

    const titles = {
        temperature: '<i class="fas fa-temperature-high me-2"></i>Temperaturer',
        power: '<i class="fas fa-bolt me-2"></i>Effekt',
        cop: '<i class="fas fa-chart-line me-2"></i>COP (Värmefaktor)',
        energy: '<i class="fas fa-pie-chart me-2"></i>Energifördelning'
    };

    titleEl.innerHTML = titles[chartType] || titles.temperature;

    // Show/hide series toggles (only for temperature chart)
    const seriesRow = document.getElementById('series-toggles-row');
    if (seriesRow) {
        seriesRow.style.display = chartType === 'temperature' ? 'block' : 'none';
    }
}

function switchChart(chartType) {
    currentChartType = chartType;
    if (chartData) {
        updateMainChart(chartData);
    }
}

function updateSeriesVisibility() {
    if (chartData && currentChartType === 'temperature') {
        renderTemperatureChart(chartData);
    }
}

function updateChartOverlays() {
    if (chartData) {
        updateMainChart(chartData);
    }
}

function resizeMainChart() {
    if (mainChart) {
        mainChart.resize();
    }
}

// ==================== Analys Stats ====================

function updateAnalysStats(data) {
    if (!data.status || !data.status.current) return;

    const current = data.status.current;
    const kpi = data.kpi || {};

    // Temperature stats (use radiator forward as example)
    if (current.radiator_forward) {
        const rf = current.radiator_forward;
        const minEl = document.getElementById('stat-min-temp');
        const maxEl = document.getElementById('stat-max-temp');
        const avgEl = document.getElementById('stat-avg-temp');
        if (minEl) minEl.textContent = rf.min !== null ? `${rf.min.toFixed(1)}°C` : '--';
        if (maxEl) maxEl.textContent = rf.max !== null ? `${rf.max.toFixed(1)}°C` : '--';
        if (avgEl) avgEl.textContent = rf.avg !== null ? `${rf.avg.toFixed(1)}°C` : '--';
    }

    // Runtime
    if (kpi.runtime) {
        const percent = kpi.runtime.compressor_runtime_percent;
        const el = document.getElementById('stat-comp-runtime');
        if (el) el.textContent = percent !== undefined ? `${percent.toFixed(1)}%` : '--';
    }

    // Energy
    if (kpi.energy) {
        const energyEl = document.getElementById('stat-energy');
        const costEl = document.getElementById('stat-cost');
        if (energyEl) energyEl.textContent = kpi.energy.total_kwh !== undefined ? `${kpi.energy.total_kwh.toFixed(1)} kWh` : '--';
        if (costEl) costEl.textContent = kpi.energy.total_cost !== undefined ? `${kpi.energy.total_cost.toFixed(0)} kr` : '--';
    }
}

// ==================== Exports ====================

window.initMainChart = initMainChart;
window.updateMainChart = updateMainChart;
window.updateAnalysStats = updateAnalysStats;
window.switchChart = switchChart;
window.updateSeriesVisibility = updateSeriesVisibility;
window.updateChartOverlays = updateChartOverlays;
window.resizeMainChart = resizeMainChart;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initMainChart();
});

console.log('📊 Charts module loaded (Analys view)');

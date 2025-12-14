/**
 * ECharts Management for Heat Pump Dashboard
 * Handles initialization and updates for all 7 charts
 */

// Store chart instances globally
const charts = {};

// Store dashboard configuration
let dashboardConfig = null;

// Default colors (fallback if config not loaded)
const DEFAULT_COLORS = {
    outdoor_temp: '#64b5f6',
    indoor_temp: '#4caf50',
    hot_water_top: '#ff9800',
    radiator_forward: '#dc143c',
    radiator_return: '#ffd700',
    brine_in_evaporator: '#00d4ff',
    brine_out_condenser: '#1565c0',
    compressor: '#4caf50',
    aux_heater: '#ffc107',
    power: '#9b59b6',
    delta_brine: '#26c6da',
    delta_radiator: '#ff5722',
    cop: '#4caf50',
    cop_avg: '#ff9800'
};

/**
 * Get color from config or fallback to default
 * @param {string} key - Color key from config_colors.py
 * @returns {string} Hex color code
 */
function getColor(key) {
    if (dashboardConfig && dashboardConfig.colors && dashboardConfig.colors[key]) {
        return dashboardConfig.colors[key];
    }
    return DEFAULT_COLORS[key] || '#666666';
}

// ==================== Helper Functions ====================

/**
 * Safely format a number with toFixed, handling null/undefined values
 * @param {number|null|undefined} value - The value to format
 * @param {number} decimals - Number of decimal places
 * @param {string} fallback - Fallback string for null values
 * @returns {string} Formatted number or fallback
 */
function safeFixed(value, decimals = 1, fallback = '--') {
    if (value === null || value === undefined || isNaN(value)) {
        return fallback;
    }
    return value.toFixed(decimals);
}

// ==================== Chart Initialization ====================

function initializeCharts(data) {
    console.log('📈 Initializing all charts...');

    // Store configuration
    if (data.config) {
        dashboardConfig = data.config;
    }

    // Initialize each chart instance with loading animation
    const chartIds = ['cop-chart', 'temperature-chart', 'runtime-chart', 'sankey-chart',
                      'performance-chart', 'power-chart', 'valve-chart'];
    const chartKeys = ['cop', 'temperature', 'runtime', 'sankey', 'performance', 'power', 'valve'];

    chartKeys.forEach((key, index) => {
        const element = document.getElementById(chartIds[index]);
        if (element) {
            charts[key] = echarts.init(element);
            // Show loading animation
            charts[key].showLoading('default', {
                text: 'Laddar data...',
                color: '#ff8c42',
                textColor: '#666',
                maskColor: 'rgba(255, 255, 255, 0.8)',
                zlevel: 0
            });
        }
    });

    // Initialize sparkline charts
    const sparklineIds = ['sparkline-brine-in', 'sparkline-brine-out',
                          'sparkline-radiator-forward', 'sparkline-radiator-return'];
    sparklineIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            charts[id] = echarts.init(element);
        }
    });

    // Update all charts with initial data
    updateAllCharts(data);

    // Hide loading animations
    Object.values(charts).forEach(chart => {
        if (chart) chart.hideLoading();
    });

    // Make charts responsive
    window.addEventListener('resize', () => {
        Object.values(charts).forEach(chart => {
            if (chart) chart.resize();
        });
    });

    console.log('✅ All charts initialized');
}

// ==================== Update All Charts ====================

function updateAllCharts(data) {
    if (data.cop) updateCopChart(data.cop);
    if (data.temperature) {
        updateTemperatureChart(data.temperature);
        updateSparklines(data.temperature);
    }
    if (data.runtime) updateRuntimeChart(data.runtime);
    if (data.sankey) updateSankeyChart(data.sankey);
    if (data.performance) updatePerformanceChart(data.performance);
    if (data.power) updatePowerChart(data.power);
    if (data.valve) updateValveChart(data.valve);
}

// ==================== Sparkline Charts ====================

function updateSparklines(temperatureData) {
    const sparklineConfigs = [
        { id: 'sparkline-brine-in', dataKey: 'brine_in_evaporator', colorKey: 'brine_in_evaporator' },
        { id: 'sparkline-brine-out', dataKey: 'brine_out_condenser', colorKey: 'brine_out_condenser' },
        { id: 'sparkline-radiator-forward', dataKey: 'radiator_forward', colorKey: 'radiator_forward' },
        { id: 'sparkline-radiator-return', dataKey: 'radiator_return', colorKey: 'radiator_return' }
    ];

    sparklineConfigs.forEach(config => {
        const chart = charts[config.id];
        if (!chart || !temperatureData[config.dataKey] || !temperatureData.timestamps) return;

        const data = temperatureData[config.dataKey];
        const timestamps = temperatureData.timestamps;
        const color = getColor(config.colorKey);

        // Create chart data from current time range selection
        const chartData = data.map((value, index) => [timestamps[index], value]);

        const option = {
            grid: {
                left: 0,
                right: 0,
                top: 2,
                bottom: 2
            },
            xAxis: {
                type: 'time',
                show: false
            },
            yAxis: {
                type: 'value',
                show: false
            },
            series: [{
                type: 'line',
                data: chartData,
                smooth: true,
                symbol: 'none',
                lineStyle: {
                    color: color,
                    width: 1.5
                },
                areaStyle: {
                    color: {
                        type: 'linear',
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                            { offset: 0, color: color + '40' },
                            { offset: 1, color: color + '05' }
                        ]
                    }
                }
            }]
        };

        chart.setOption(option, true);
    });
}

// ==================== Chart 1: COP Line Chart ====================

function updateCopChart(data) {
    if (!data.values || data.values.length === 0) {
        console.warn('No COP data available');
        return;
    }

    const copColor = getColor('cop');
    const copAvgColor = getColor('cop_avg');

    const option = {
        grid: {
            left: 50,
            right: 15,
            top: 35,
            bottom: 50,
            backgroundColor: 'transparent'
        },
        xAxis: {
            type: 'time',
            name: 'Tid',
            nameLocation: 'middle',
            nameGap: 35,
            axisLine: { lineStyle: { color: '#999' } },
            axisLabel: { fontSize: 10 }
        },
        yAxis: {
            type: 'value',
            name: 'COP',
            min: 0,
            max: 6,
            axisLine: { lineStyle: { color: '#999' } },
            splitLine: { lineStyle: { color: '#eee' } },
            axisLabel: { fontSize: 10 }
        },
        series: [{
            type: 'line',
            name: 'COP',
            data: data.timestamps.map((t, i) => [t, data.values[i]]),
            smooth: false,
            showSymbol: true,
            symbolSize: 6,
            lineStyle: {
                color: copColor,
                width: 2.5
            },
            areaStyle: {
                color: {
                    type: 'linear',
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                        { offset: 0, color: copColor + '66' },
                        { offset: 1, color: copColor + '0d' }
                    ]
                }
            },
            markLine: {
                silent: false,
                symbol: 'none',
                lineStyle: {
                    type: 'dashed',
                    color: copAvgColor,
                    width: 2
                },
                label: {
                    position: 'end',
                    formatter: `Medel: ${safeFixed(data.avg, 2)}`,
                    fontSize: 11,
                    color: copAvgColor
                },
                data: [{
                    yAxis: data.avg !== null ? data.avg : 0
                }]
            }
        }],
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross',
                label: { backgroundColor: '#6a7985' }
            },
            formatter: (params) => {
                const date = new Date(params[0].value[0]);
                const time = date.toLocaleTimeString('sv-SE');
                const value = params[0].value[1];
                return `${time}<br/>COP: <b>${safeFixed(value, 2)}</b>`;
            }
        },
        backgroundColor: 'transparent'
    };

    charts.cop.setOption(option, true);
}

// ==================== Chart 2: Temperature Multi-line Chart ====================

function updateTemperatureChart(data) {
    if (!data.timestamps || data.timestamps.length === 0) {
        console.warn('No temperature data available');
        return;
    }

    const metrics = [
        { key: 'hot_water_top', name: 'Varmvatten', colorKey: 'hot_water_top' },
        { key: 'radiator_forward', name: 'Radiator Fram ↑', colorKey: 'radiator_forward' },
        { key: 'radiator_return', name: 'Radiator Retur ↓', colorKey: 'radiator_return' },
        { key: 'indoor_temp', name: 'Inne', colorKey: 'indoor_temp' },
        { key: 'outdoor_temp', name: 'Ute', colorKey: 'outdoor_temp' },
        { key: 'brine_in_evaporator', name: 'KB In →', colorKey: 'brine_in_evaporator' },
        { key: 'brine_out_condenser', name: 'KB Ut ←', colorKey: 'brine_out_condenser' }
    ];

    const series = [];
    const legendData = [];

    metrics.forEach(metric => {
        if (data[metric.key] && data[metric.key].length > 0) {
            const color = getColor(metric.colorKey);
            legendData.push(metric.name);
            series.push({
                type: 'line',
                name: metric.name,
                data: data[metric.key].map((v, i) => [data.timestamps[i], v]),
                smooth: true,
                lineStyle: { color: color, width: 2.5 },
                itemStyle: { color: color },
                showSymbol: false
            });
        }
    });

    const option = {
        grid: {
            left: 60,
            right: 40,
            top: 80,
            bottom: 60,
            backgroundColor: 'transparent'
        },
        legend: {
            data: legendData,
            top: 10,
            right: 10,
            orient: 'horizontal',
            textStyle: { fontSize: 11 }
        },
        xAxis: {
            type: 'time',
            name: 'Tid',
            nameLocation: 'middle',
            nameGap: 40,
            axisLine: { lineStyle: { color: '#999' } }
        },
        yAxis: {
            type: 'value',
            name: 'Temperatur (°C)',
            axisLine: { lineStyle: { color: '#999' } },
            splitLine: { lineStyle: { color: '#eee' } }
        },
        series: series,
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(param => {
                    const value = param.value[1];
                    const roundedValue = value !== null && value !== undefined ? value.toFixed(1) : '--';
                    result += param.marker + ' ' + param.seriesName + ': ' + roundedValue + '°C<br/>';
                });
                return result;
            }
        },
        backgroundColor: 'transparent'
    };

    charts.temperature.setOption(option, true);
}

// ==================== Chart 3: Runtime Pie Chart ====================

function updateRuntimeChart(data) {
    const option = {
        series: [{
            type: 'pie',
            radius: ['40%', '70%'],
            data: [
                {
                    value: data.compressor_percent,
                    name: 'Kompressor',
                    itemStyle: { color: getColor('compressor') }
                },
                {
                    value: data.aux_heater_percent,
                    name: 'Tillsats',
                    itemStyle: { color: getColor('aux_heater') }
                },
                {
                    value: data.inactive_percent,
                    name: 'Inaktiv',
                    itemStyle: { color: '#e9ecef' }
                }
            ],
            label: {
                formatter: '{b}: {d}%',
                fontSize: 13,
                position: 'outside',
                overflow: 'none'
            },
            labelLine: {
                show: true,
                length: 15,
                length2: 10
            },
            emphasis: {
                itemStyle: {
                    shadowBlur: 10,
                    shadowOffsetX: 0,
                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                }
            }
        }],
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c}% ({d}%)'
        },
        backgroundColor: 'transparent'
    };

    charts.runtime.setOption(option, true);
}

// ==================== Chart 4: Sankey Energy Flow ====================

function updateSankeyChart(data) {
    if (!data.nodes || data.nodes.length === 0) {
        console.warn('No Sankey data available');
        return;
    }

    const option = {
        title: {
            text: `COP: ${safeFixed(data.cop, 2)} (${safeFixed(data.free_energy_percent, 0)}% från mark)`,
            textStyle: { fontSize: 13, color: '#666', fontWeight: 'normal' },
            left: 'center',
            top: 5
        },
        grid: {
            left: 10,
            right: 10,
            top: 35,
            bottom: 10
        },
        series: [{
            type: 'sankey',
            layout: 'none',
            emphasis: { focus: 'adjacency' },
            data: data.nodes,
            links: data.links.map(link => ({
                source: link.source,
                target: link.target,
                value: link.value
            })),
            nodeWidth: 20,
            nodeGap: 12,
            lineStyle: {
                color: 'gradient',
                curveness: 0.5,
                opacity: 0.5
            },
            itemStyle: {
                borderWidth: 1,
                borderColor: '#fff'
            },
            label: {
                color: '#333',
                fontSize: 11,
                fontWeight: 'bold'
            }
        }],
        tooltip: {
            trigger: 'item',
            formatter: (params) => {
                if (params.dataType === 'edge') {
                    return `${params.data.source} → ${params.data.target}<br/>Energi: ${safeFixed(params.value, 0)}`;
                } else {
                    return `${params.name}`;
                }
            }
        },
        backgroundColor: 'transparent'
    };

    charts.sankey.setOption(option, true);
}

// ==================== Chart 5: Performance (2 subplots) ====================

function updatePerformanceChart(data) {
    const option = {
        grid: [
            { left: 70, right: 50, top: 80, height: '35%' },
            { left: 70, right: 50, top: '58%', height: '30%' }
        ],
        title: [
            { text: 'Temperaturdifferenser', left: 'center', top: 50, textStyle: { fontSize: 14 } },
            { text: 'Kompressor Drifttid', left: 'center', top: '50%', textStyle: { fontSize: 14 } }
        ],
        xAxis: [
            { gridIndex: 0, type: 'time', show: false },
            { gridIndex: 1, type: 'time', name: 'Tid', nameLocation: 'middle', nameGap: 30 }
        ],
        yAxis: [
            { gridIndex: 0, name: 'ΔT (°C)', splitLine: { lineStyle: { color: '#eee' } } },
            { gridIndex: 1, name: 'Status', min: -0.1, max: 1.1, splitLine: { lineStyle: { color: '#eee' } } }
        ],
        series: [
            {
                name: 'KB ΔT',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: data.brine_delta || [],
                lineStyle: { color: getColor('delta_brine'), width: 2.5 },
                showSymbol: false
            },
            {
                name: 'Radiator ΔT',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: data.radiator_delta || [],
                lineStyle: { color: getColor('delta_radiator'), width: 2.5 },
                showSymbol: false
            },
            {
                name: 'Kompressor',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: data.compressor_status || [],
                areaStyle: { color: getColor('compressor') + '4d' },
                lineStyle: { color: getColor('compressor'), width: 2.5 },
                showSymbol: false,
                step: 'end'
            }
        ],
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(param => {
                    const value = param.value[1];
                    let roundedValue;
                    if (value !== null && value !== undefined) {
                        // For status values (0 or 1), show without decimals
                        roundedValue = (value === 0 || value === 1) ? value.toString() : value.toFixed(1);
                    } else {
                        roundedValue = '--';
                    }
                    const unit = param.seriesName.includes('ΔT') ? '°C' : '';
                    result += param.marker + ' ' + param.seriesName + ': ' + roundedValue + unit + '<br/>';
                });
                return result;
            }
        },
        backgroundColor: 'transparent'
    };

    charts.performance.setOption(option, true);
}

// ==================== Chart 6: Power (2 subplots) ====================

function updatePowerChart(data) {
    const option = {
        grid: [
            { left: 70, right: 50, top: 80, height: '35%' },
            { left: 70, right: 50, top: '58%', height: '30%' }
        ],
        title: [
            { text: 'Effektförbrukning', left: 'center', top: 50, textStyle: { fontSize: 14 } },
            { text: 'Systemstatus', left: 'center', top: '50%', textStyle: { fontSize: 14 } }
        ],
        xAxis: [
            { gridIndex: 0, type: 'time', show: false },
            { gridIndex: 1, type: 'time', name: 'Tid', nameLocation: 'middle', nameGap: 30 }
        ],
        yAxis: [
            { gridIndex: 0, name: 'Effekt (W)', splitLine: { lineStyle: { color: '#eee' } } },
            { gridIndex: 1, name: 'Status / %', splitLine: { lineStyle: { color: '#eee' } } }
        ],
        series: [
            {
                name: 'Effekt',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: data.power_consumption || [],
                lineStyle: { color: getColor('power'), width: 2.5 },
                areaStyle: { color: getColor('power') + '33' },
                showSymbol: false
            },
            {
                name: 'Kompressor',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: data.compressor_status || [],
                lineStyle: { color: getColor('compressor'), width: 2.5 },
                showSymbol: false,
                step: 'end'
            },
            {
                name: 'Tillsats %',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: data.additional_heat_percent || [],
                lineStyle: { color: getColor('aux_heater'), width: 2.5 },
                showSymbol: false
            }
        ],
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(param => {
                    const value = param.value[1];
                    let roundedValue;
                    if (value !== null && value !== undefined) {
                        // For status values (0 or 1), show without decimals
                        roundedValue = (value === 0 || value === 1) ? value.toString() : value.toFixed(1);
                    } else {
                        roundedValue = '--';
                    }
                    let unit = '';
                    if (param.seriesName === 'Effekt') {
                        unit = ' W';
                    } else if (param.seriesName === 'Tillsats %') {
                        unit = '%';
                    }
                    result += param.marker + ' ' + param.seriesName + ': ' + roundedValue + unit + '<br/>';
                });
                return result;
            }
        },
        backgroundColor: 'transparent'
    };

    charts.power.setOption(option, true);
}

// ==================== Chart 7: Valve Status (3 subplots) ====================

function updateValveChart(data) {
    const option = {
        grid: [
            { left: 70, right: 50, top: 80, height: '22%' },
            { left: 70, right: 50, top: '40%', height: '22%' },
            { left: 70, right: 50, top: '70%', height: '22%' }
        ],
        title: [
            { text: 'Växelventilsläge (1=Varmvatten, 0=Uppvärmning)', left: 'center', top: 50, textStyle: { fontSize: 13 } },
            { text: 'Kompressorstatus (1=PÅ, 0=AV)', left: 'center', top: '32%', textStyle: { fontSize: 13 } },
            { text: 'Varmvattentemperatur (°C)', left: 'center', top: '62%', textStyle: { fontSize: 13 } }
        ],
        xAxis: [
            { gridIndex: 0, type: 'time', show: false },
            { gridIndex: 1, type: 'time', show: false },
            { gridIndex: 2, type: 'time', name: 'Tid', nameLocation: 'middle', nameGap: 30 }
        ],
        yAxis: [
            { gridIndex: 0, name: 'Status', min: -0.1, max: 1.1, splitLine: { lineStyle: { color: '#eee' } } },
            { gridIndex: 1, name: 'Status', min: -0.1, max: 1.1, splitLine: { lineStyle: { color: '#eee' } } },
            { gridIndex: 2, name: 'Temp (°C)', splitLine: { lineStyle: { color: '#eee' } } }
        ],
        series: [
            {
                name: 'Växelventil',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: data.valve_status || [],
                lineStyle: { color: getColor('hot_water_top'), width: 3 },
                areaStyle: { color: getColor('hot_water_top') + '4d' },
                showSymbol: false,
                step: 'end'
            },
            {
                name: 'Kompressor',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: data.compressor_status || [],
                lineStyle: { color: getColor('compressor'), width: 2.5 },
                areaStyle: { color: getColor('compressor') + '33' },
                showSymbol: false,
                step: 'end'
            },
            {
                name: 'VV Temp',
                type: 'line',
                xAxisIndex: 2,
                yAxisIndex: 2,
                data: data.hot_water_temp || [],
                lineStyle: { color: getColor('hot_water_top'), width: 2.5 },
                showSymbol: false
            }
        ],
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            formatter: function(params) {
                let result = params[0].axisValueLabel + '<br/>';
                params.forEach(param => {
                    const value = param.value[1];
                    let roundedValue;
                    if (value !== null && value !== undefined) {
                        // For status values (0 or 1), show without decimals
                        if (value === 0 || value === 1) {
                            roundedValue = value.toString();
                        } else {
                            roundedValue = value.toFixed(1);
                        }
                    } else {
                        roundedValue = '--';
                    }
                    const unit = param.seriesName === 'VV Temp' ? '°C' : '';
                    result += param.marker + ' ' + param.seriesName + ': ' + roundedValue + unit + '<br/>';
                });
                return result;
            }
        },
        backgroundColor: 'transparent'
    };

    charts.valve.setOption(option, true);
}

// ==================== KPI Updates ====================

function updateKPIs(data) {
    // Basic KPIs (existing)
    // COP
    if (data.cop && data.cop.avg !== undefined) {
        document.getElementById('kpi-cop').textContent = safeFixed(data.cop.avg, 2);
    }

    // Hot water temperature (latest value)
    if (data.temperature && data.temperature.hot_water_top) {
        const temps = data.temperature.hot_water_top;
        if (temps.length > 0) {
            const latest = temps[temps.length - 1];
            document.getElementById('kpi-hot-water').textContent = `${safeFixed(latest, 0)}°C`;
        }
    }

    // Extended KPIs (new)
    if (data.kpi) {
        // Energy Cost & Consumption
        if (data.kpi.energy) {
            const energy = data.kpi.energy;
            document.getElementById('kpi-energy-cost').textContent = `${safeFixed(energy.total_cost, 0)} kr`;
            document.getElementById('kpi-energy-kwh').textContent = `${safeFixed(energy.total_kwh, 1)} kWh`;
        }

        // Compressor Runtime Stats
        if (data.kpi.runtime) {
            const runtime = data.kpi.runtime;
            document.getElementById('kpi-compressor').textContent = `${safeFixed(runtime.compressor_percent, 0)}%`;
            document.getElementById('kpi-comp-hours').textContent = `${safeFixed(runtime.compressor_hours, 1)} timmar`;

            // Aux Heater Runtime
            document.getElementById('kpi-aux-runtime').textContent = `${safeFixed(runtime.aux_heater_percent, 0)}%`;
            document.getElementById('kpi-aux-hours').textContent = `${safeFixed(runtime.aux_heater_hours, 1)} timmar`;
        }

        // Hot Water Cycles
        if (data.kpi.hot_water) {
            const hw = data.kpi.hot_water;
            document.getElementById('kpi-hw-cycles').textContent = hw.total_cycles || '--';
            document.getElementById('kpi-hw-cycles-per-day').textContent = `${safeFixed(hw.cycles_per_day, 1)} /dag`;
        }
    }
}

// ==================== Export Functions ====================

// Make functions available globally
window.initializeCharts = initializeCharts;
window.updateAllCharts = updateAllCharts;
window.updateKPIs = updateKPIs;

console.log('🎨 Charts module loaded');

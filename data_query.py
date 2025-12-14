"""
Heat Pump Data Query & Calculations - Multi-Brand Support
Handles all InfluxDB queries and advanced calculations
Supports: Thermia, IVT

FEATURES:
1. Brand-aware alarm codes
2. Varmvattenberäkning med verklig effekt under cykler
3. Flexibel aggregering baserat på tidsperiod
4. Bättre tidshantering i alla beräkningar
5. Suppression av InfluxDB pivot-varningar (queries fungerar korrekt)
"""

import os
import sys
import logging
import warnings
import yaml
from typing import List, Dict, Any, Optional
import pandas as pd
import numpy as np
from influxdb_client import InfluxDBClient
from influxdb_client.client.warnings import MissingPivotFunction

# Add parent directory to path for provider imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from providers import get_provider

# Suppresa InfluxDB pivot-varningar (våra queries fungerar korrekt med pandas)
warnings.simplefilter("ignore", MissingPivotFunction)

logger = logging.getLogger(__name__)


class HeatPumpDataQuery:
    """Query data from InfluxDB with advanced calculations"""

    def __init__(self, config_path: str = '/app/config.yaml'):
        """Initialize InfluxDB client and load provider"""
        self.url = os.getenv('INFLUXDB_URL', 'http://influxdb:8086')
        self.token = os.getenv('INFLUXDB_TOKEN')
        self.org = os.getenv('INFLUXDB_ORG', 'thermia')
        self.bucket = os.getenv('INFLUXDB_BUCKET', 'heatpump')
        self.client = InfluxDBClient(url=self.url, token=self.token, org=self.org)
        self.query_api = self.client.query_api()

        # Load provider based on config
        self.provider = self._load_provider(config_path)
        self.alarm_codes = self.provider.get_alarm_codes()
        self.alarm_register_id = self.provider.get_alarm_register_id()
        logger.info(f"Data query initialized for {self.provider.get_display_name()}")

    def _load_provider(self, config_path: str):
        """Load provider from config"""
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    config = yaml.safe_load(f)
                brand = config.get('brand', 'thermia')
            else:
                brand = os.getenv('HEATPUMP_BRAND', 'thermia')

            return get_provider(brand)
        except Exception as e:
            logger.warning(f"Failed to load provider from config: {e}, defaulting to Thermia")
            from providers.thermia.provider import ThermiaProvider
            return ThermiaProvider()
    
    def _get_aggregation_window(self, time_range: str) -> str:
        """
        NYTT: Dynamisk aggregering baserat på tidsperiod

        Returnerar lämpligt aggregeringsfönster för att balansera prestanda och noggrannhet.
        Mer aggressiv nedsampling för längre perioder för bättre prestanda.
        """
        # Extrahera numeriskt värde och enhet från time_range (t.ex. "24h", "7d")
        if time_range.endswith('h'):
            hours = int(time_range[:-1])
            if hours <= 1:
                return "1m"   # 1 timme = 1 minut aggregering (~60 datapunkter)
            elif hours <= 6:
                return "3m"   # 6 timmar = 3 minuter (~120 datapunkter)
            elif hours <= 24:
                return "5m"   # 24 timmar = 5 minuter (~288 datapunkter)
            else:
                return "15m"  # >24 timmar = 15 minuter
        elif time_range.endswith('d'):
            days = int(time_range[:-1])
            if days <= 1:
                return "5m"   # 1 dag = 5 minuter (~288 datapunkter)
            elif days <= 7:
                return "30m"  # 7 dagar = 30 minuter (~336 datapunkter) - IMPROVED
            elif days <= 30:
                return "2h"   # 30 dagar = 2 timmar (~360 datapunkter) - IMPROVED
            else:
                return "6h"   # >30 dagar = 6 timmar
        else:
            return "5m"  # Default
    
    def query_metrics(self, metric_names: List[str], time_range: str = '24h', 
                     aggregation_window: Optional[str] = None) -> pd.DataFrame:
        """
        Query metrics from InfluxDB
        
        FÖRBÄTTRING: Nu med konfigurerbar aggregering
        
        Args:
            metric_names: Lista över metrics att hämta
            time_range: Tidsperiod (t.ex. '24h', '7d')
            aggregation_window: Specifikt aggregeringsfönster (None = automatisk)
        """
        try:
            name_filter = ' or '.join([f'r.name == "{name}"' for name in metric_names])
            
            # Använd angiven aggregering eller beräkna automatiskt
            if aggregation_window is None:
                aggregation_window = self._get_aggregation_window(time_range)
            
            query = f'''
                from(bucket: "{self.bucket}")
                    |> range(start: -{time_range})
                    |> filter(fn: (r) => r._measurement == "heatpump")
                    |> filter(fn: (r) => {name_filter})
                    |> aggregateWindow(every: {aggregation_window}, fn: mean, createEmpty: false)
                    |> yield(name: "mean")
            '''
            
            logger.debug(f"Querying metrics with {aggregation_window} aggregation for {time_range}")
            
            result = self.query_api.query_data_frame(query)

            if isinstance(result, list):
                result = pd.concat(result, ignore_index=True)

            # Convert raw INT values to proper display values (divide by 10 for most metrics)
            if not result.empty and '_value' in result.columns and 'name' in result.columns:
                # Fields that should NOT be divided (already in correct units)
                no_division_fields = [
                    'compressor_status', 'brine_pump_status', 'radiator_pump_status',
                    'switch_valve_status', 'alarm_status', 'alarm_code',
                    'operating_mode', 'external_control',
                    'power_consumption'  # Already in Watts
                ]

                # Apply division to all other fields
                for idx, row in result.iterrows():
                    metric_name = row.get('name', '')
                    if metric_name not in no_division_fields:
                        result.at[idx, '_value'] = row['_value'] / 10.0

            return result
            
        except Exception as e:
            logger.error(f"Error querying metrics: {e}")
            return pd.DataFrame()
    
    def get_latest_values(self) -> Dict[str, Any]:
        """Get latest values for all metrics"""
        try:
            query = f'''
                from(bucket: "{self.bucket}")
                    |> range(start: -1h)
                    |> filter(fn: (r) => r._measurement == "heatpump")
                    |> last()
            '''
            
            result = self.query_api.query_data_frame(query)

            if isinstance(result, list):
                result = pd.concat(result, ignore_index=True)

            # Fields that should NOT be divided (already in correct units)
            no_division_fields = [
                'compressor_status', 'brine_pump_status', 'radiator_pump_status',
                'switch_valve_status', 'alarm_status', 'alarm_code',
                'operating_mode', 'external_control',
                'power_consumption'  # Already in Watts
            ]

            latest = {}
            if not result.empty:
                for _, row in result.iterrows():
                    metric_name = row['name']
                    raw_value = row['_value']

                    # Convert raw INT to display value (divide by 10 for most metrics)
                    if metric_name not in no_division_fields:
                        display_value = raw_value / 10.0
                    else:
                        display_value = raw_value

                    latest[metric_name] = {
                        'value': display_value,
                        'unit': row.get('unit', ''),
                        'time': row['_time']
                    }

            return latest
            
        except Exception as e:
            logger.error(f"Error getting latest values: {e}")
            return {}
    
    def get_min_max_values(self, time_range: str = '24h') -> Dict[str, Dict[str, float]]:
        """Get MIN and MAX values for all metrics over the specified time range"""
        try:
            query_min = f'''
                from(bucket: "{self.bucket}")
                    |> range(start: -{time_range})
                    |> filter(fn: (r) => r._measurement == "heatpump")
                    |> group(columns: ["name"])
                    |> min()
            '''
            
            query_max = f'''
                from(bucket: "{self.bucket}")
                    |> range(start: -{time_range})
                    |> filter(fn: (r) => r._measurement == "heatpump")
                    |> group(columns: ["name"])
                    |> max()
            '''
            
            result_min = self.query_api.query_data_frame(query_min)
            result_max = self.query_api.query_data_frame(query_max)
            
            if isinstance(result_min, list):
                result_min = pd.concat(result_min, ignore_index=True)
            if isinstance(result_max, list):
                result_max = pd.concat(result_max, ignore_index=True)
            
            min_max = {}
            
            if not result_min.empty:
                for _, row in result_min.iterrows():
                    metric_name = row['name']
                    if metric_name not in min_max:
                        min_max[metric_name] = {}
                    min_max[metric_name]['min'] = row['_value']
            
            if not result_max.empty:
                for _, row in result_max.iterrows():
                    metric_name = row['name']
                    if metric_name not in min_max:
                        min_max[metric_name] = {}
                    min_max[metric_name]['max'] = row['_value']
            
            return min_max
            
        except Exception as e:
            logger.error(f"Error getting min/max values: {e}")
            return {}
    
    def calculate_cop_from_df(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate COP (Coefficient of Performance) from pre-fetched dataframe

        OPTIMIZED: Uses existing dataframe to avoid redundant InfluxDB query

        COP = Heat Output / Electrical Input
        Simplified calculation using temperature deltas
        """
        try:
            if df.empty:
                return pd.DataFrame()

            # Filter to only COP-related metrics
            cop_metrics = [
                'radiator_forward',
                'radiator_return',
                'brine_in_evaporator',
                'brine_out_condenser',
                'power_consumption',
                'compressor_status'
            ]

            df_filtered = df[df['name'].isin(cop_metrics)].copy()

            if df_filtered.empty:
                return pd.DataFrame()

            # Pivot to get each metric as a column
            df_pivot = df_filtered.pivot_table(
                index='_time',
                columns='name',
                values='_value',
                aggfunc='mean'
            ).reset_index()

            # Calculate temperature deltas
            if 'radiator_forward' in df_pivot.columns and 'radiator_return' in df_pivot.columns:
                df_pivot['radiator_delta'] = df_pivot['radiator_forward'] - df_pivot['radiator_return']

            if 'brine_in_evaporator' in df_pivot.columns and 'brine_out_condenser' in df_pivot.columns:
                df_pivot['brine_delta'] = df_pivot['brine_in_evaporator'] - df_pivot['brine_out_condenser']

            # Simplified COP calculation
            if 'radiator_delta' in df_pivot.columns and 'brine_delta' in df_pivot.columns:
                mask = (
                    (df_pivot.get('compressor_status', 0) > 0) &
                    (df_pivot['brine_delta'] > 0.5) &
                    (df_pivot['radiator_delta'] > 0.5)
                )

                df_pivot.loc[mask, 'estimated_cop'] = 2.0 + (
                    df_pivot.loc[mask, 'radiator_delta'] / df_pivot.loc[mask, 'brine_delta']
                )

                # Clamp to reasonable values (1.5 - 6.0)
                df_pivot['estimated_cop'] = df_pivot['estimated_cop'].clip(1.5, 6.0)

            return df_pivot

        except Exception as e:
            logger.error(f"Error calculating COP from dataframe: {e}")
            return pd.DataFrame()

    def calculate_cop(self, time_range: str = '24h') -> pd.DataFrame:
        """
        Calculate COP (Coefficient of Performance) over time

        Uses optimized aggregation for smooth COP visualization
        Finer granularity than batch query for better chart quality

        COP = Heat Output / Electrical Input
        Simplified calculation using temperature deltas
        """
        try:
            metrics = [
                'radiator_forward',
                'radiator_return',
                'brine_in_evaporator',
                'brine_out_condenser',
                'power_consumption',
                'compressor_status'
            ]

            # Use finer aggregation for COP visualization (smoother charts)
            # 7d: 10m instead of 30m, 30d: 30m instead of 2h
            cop_aggregation = self._get_cop_aggregation_window(time_range)
            df = self.query_metrics(metrics, time_range, aggregation_window=cop_aggregation)

            # Use the optimized method
            return self.calculate_cop_from_df(df)

        except Exception as e:
            logger.error(f"Error calculating COP: {e}")
            return pd.DataFrame()

    def _get_cop_aggregation_window(self, time_range: str) -> str:
        """
        Get optimal aggregation window for COP calculation

        Uses finer granularity than batch queries for smoother visualization
        UPDATED: 10m for both 7d and 30d for consistent fine granularity
        """
        if time_range.endswith('h'):
            hours = int(time_range[:-1])
            if hours <= 1:
                return "1m"
            elif hours <= 6:
                return "2m"
            elif hours <= 24:
                return "5m"
            else:
                return "10m"
        elif time_range.endswith('d'):
            days = int(time_range[:-1])
            if days <= 1:
                return "5m"
            elif days <= 7:
                return "10m"  # 7d: 10m aggregation (~1000 points)
            elif days <= 30:
                return "10m"  # 30d: 10m aggregation (~4320 points) - FINER!
            else:
                return "1h"
        else:
            return "5m"
    
    def calculate_energy_costs(self, time_range: str = '24h', price_per_kwh: float = 2.0) -> Dict[str, Any]:
        """
        Calculate energy consumption and costs
        
        KORREKT: Använder verklig tid mellan datapunkter
        """
        try:
            df = self.query_metrics(['power_consumption'], time_range)
            
            if df.empty:
                return {
                    'total_kwh': 0,
                    'total_cost': 0,
                    'avg_power': 0,
                    'peak_power': 0
                }
            
            df = df.sort_values('_time')
            
            # Calculate time differences in hours - ANVÄNDER VERKLIG TID
            df['time_diff_hours'] = df['_time'].diff().dt.total_seconds() / 3600
            df['time_diff_hours'] = df['time_diff_hours'].fillna(0)
            
            # Energy = Power (W) * Time (h) / 1000 (to get kWh)
            df['energy_kwh'] = (df['_value'] * df['time_diff_hours']) / 1000
            
            total_kwh = df['energy_kwh'].sum()
            total_cost = total_kwh * price_per_kwh
            avg_power = df['_value'].mean()
            peak_power = df['_value'].max()
            
            return {
                'total_kwh': round(total_kwh, 2),
                'total_cost': round(total_cost, 2),
                'avg_power': round(avg_power, 0),
                'peak_power': round(peak_power, 0)
            }
            
        except Exception as e:
            logger.error(f"Error calculating energy costs: {e}")
            return {
                'total_kwh': 0,
                'total_cost': 0,
                'avg_power': 0,
                'peak_power': 0
            }
    
    def calculate_runtime_stats(self, time_range: str = '24h') -> Dict[str, Any]:
        """
        Calculate runtime statistics for compressor and auxiliary heater
        
        KORREKT: Använder verklig tid mellan datapunkter
        """
        try:
            metrics = ['compressor_status', 'additional_heat_percent']
            df = self.query_metrics(metrics, time_range)
            
            if df.empty:
                return {
                    'compressor_runtime_hours': 0,
                    'compressor_runtime_percent': 0,
                    'aux_heater_runtime_hours': 0,
                    'aux_heater_runtime_percent': 0,
                    'total_hours': 0
                }
            
            df = df.sort_values('_time')
            
            # Beräkna total tidsperiod
            total_seconds = (df['_time'].max() - df['_time'].min()).total_seconds()
            total_hours = total_seconds / 3600
            
            if total_hours == 0:
                return {
                    'compressor_runtime_hours': 0,
                    'compressor_runtime_percent': 0,
                    'aux_heater_runtime_hours': 0,
                    'aux_heater_runtime_percent': 0,
                    'total_hours': 0
                }
            
            # Kompressor runtime - ANVÄNDER VERKLIG TID
            comp_df = df[df['name'] == 'compressor_status'].copy()
            comp_runtime_seconds = 0
            
            if not comp_df.empty:
                comp_df = comp_df.sort_values('_time')
                
                # Beräkna tiden för varje datapunkt baserat på nästa datapunkt
                for i in range(len(comp_df) - 1):
                    if comp_df.iloc[i]['_value'] > 0:  # Om kompressor är PÅ
                        # Beräkna VERKLIG tid till nästa datapunkt
                        time_diff = (comp_df.iloc[i + 1]['_time'] - comp_df.iloc[i]['_time']).total_seconds()
                        comp_runtime_seconds += time_diff
                
                # För sista datapunkten, anta samma intervall som föregående
                if len(comp_df) > 1 and comp_df.iloc[-1]['_value'] > 0:
                    avg_interval = (comp_df.iloc[-1]['_time'] - comp_df.iloc[-2]['_time']).total_seconds()
                    comp_runtime_seconds += avg_interval
            
            comp_runtime_hours = comp_runtime_seconds / 3600
            comp_runtime_percent = (comp_runtime_hours / total_hours * 100) if total_hours > 0 else 0
            
            # Auxiliary heater runtime - ANVÄNDER VERKLIG TID
            aux_df = df[df['name'] == 'additional_heat_percent'].copy()
            aux_runtime_seconds = 0
            
            if not aux_df.empty:
                aux_df = aux_df.sort_values('_time')
                
                # Beräkna tiden för varje datapunkt baserat på nästa datapunkt
                for i in range(len(aux_df) - 1):
                    if aux_df.iloc[i]['_value'] > 0:  # Om tillsats är PÅ
                        # Beräkna VERKLIG tid till nästa datapunkt
                        time_diff = (aux_df.iloc[i + 1]['_time'] - aux_df.iloc[i]['_time']).total_seconds()
                        aux_runtime_seconds += time_diff
                
                # För sista datapunkten, anta samma intervall som föregående
                if len(aux_df) > 1 and aux_df.iloc[-1]['_value'] > 0:
                    avg_interval = (aux_df.iloc[-1]['_time'] - aux_df.iloc[-2]['_time']).total_seconds()
                    aux_runtime_seconds += avg_interval
            
            aux_runtime_hours = aux_runtime_seconds / 3600
            aux_runtime_percent = (aux_runtime_hours / total_hours * 100) if total_hours > 0 else 0
            
            logger.info(f"Runtime calculation for {time_range}:")
            logger.info(f"  Total period: {total_hours:.2f} hours")
            logger.info(f"  Compressor: {comp_runtime_hours:.2f}h ({comp_runtime_percent:.1f}%)")
            logger.info(f"  Aux heater: {aux_runtime_hours:.2f}h ({aux_runtime_percent:.1f}%)")
            
            return {
                'compressor_runtime_hours': round(comp_runtime_hours, 1),
                'compressor_runtime_percent': round(comp_runtime_percent, 1),
                'aux_heater_runtime_hours': round(aux_runtime_hours, 1),
                'aux_heater_runtime_percent': round(aux_runtime_percent, 1),
                'total_hours': round(total_hours, 1)
            }
            
        except Exception as e:
            logger.error(f"Error calculating runtime stats: {e}")
            return {
                'compressor_runtime_hours': 0,
                'compressor_runtime_percent': 0,
                'aux_heater_runtime_hours': 0,
                'aux_heater_runtime_percent': 0,
                'total_hours': 0
            }
    
    def analyze_hot_water_cycles_from_df(self, df: pd.DataFrame, time_range: str = '7d') -> Dict[str, Any]:
        """
        Analyze hot water heating cycles from pre-fetched dataframe

        OPTIMIZED: Uses existing dataframe to avoid redundant InfluxDB query
        Uses batch aggregation data which may be coarser but much faster
        """
        try:
            if df.empty:
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }

            # Filter to hot water-related metrics
            valve_df = df[df['name'] == 'switch_valve_status'].copy()
            power_df = df[df['name'] == 'power_consumption'].copy()

            if valve_df.empty:
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }

            valve_df = valve_df.sort_values('_time')
            power_df = power_df.sort_values('_time')

            # Detect cycles (transitions from 0 to 1)
            valve_df['prev_value'] = valve_df['_value'].shift(1)
            cycles_start = valve_df[(valve_df['_value'] == 1) & (valve_df['prev_value'] == 0)]

            num_cycles = len(cycles_start)

            logger.info(f"Hot water cycle detection from batch data for {time_range}:")
            logger.info(f"  Detected {num_cycles} valve transitions (0→1)")

            if num_cycles == 0:
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }

            # Calculate average cycle duration AND energy
            cycle_durations = []
            cycle_energies = []

            # MINIMUM DURATION FILTER - adjusted for coarser aggregation
            MIN_CYCLE_DURATION_MINUTES = 10  # With 30m aggregation, use higher threshold

            filtered_count = 0

            for start_time in cycles_start['_time']:
                after_start = valve_df[valve_df['_time'] > start_time]
                end_times = after_start[after_start['_value'] == 0]

                if not end_times.empty:
                    end_time = end_times.iloc[0]['_time']
                    duration_seconds = (end_time - start_time).total_seconds()
                    duration_minutes = duration_seconds / 60

                    # FILTER: Skippa cykler kortare än minimum
                    if duration_minutes < MIN_CYCLE_DURATION_MINUTES:
                        filtered_count += 1
                        continue

                    cycle_durations.append(duration_minutes)

                    # Calculate energy for this cycle
                    cycle_power = power_df[
                        (power_df['_time'] >= start_time) &
                        (power_df['_time'] <= end_time)
                    ].copy()

                    if not cycle_power.empty:
                        cycle_power = cycle_power.sort_values('_time')
                        cycle_power['time_diff_hours'] = cycle_power['_time'].diff().dt.total_seconds() / 3600
                        cycle_power['time_diff_hours'] = cycle_power['time_diff_hours'].fillna(0)

                        # Energy = Power (W) * Time (h) / 1000 = kWh
                        cycle_power['energy_kwh'] = (cycle_power['_value'] * cycle_power['time_diff_hours']) / 1000

                        total_cycle_energy = cycle_power['energy_kwh'].sum()
                        cycle_energies.append(total_cycle_energy)

            # Antal giltiga cykler (efter filtrering)
            num_valid_cycles = len(cycle_durations)

            logger.info(f"  Total: {num_valid_cycles} valid cycles, {filtered_count} filtered (<{MIN_CYCLE_DURATION_MINUTES} min)")

            if num_valid_cycles == 0:
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }

            avg_duration = np.mean(cycle_durations) if cycle_durations else 0
            avg_energy_kwh = np.mean(cycle_energies) if cycle_energies else 0

            # Calculate cycles per day
            total_days = (valve_df['_time'].max() - valve_df['_time'].min()).total_seconds() / 86400
            cycles_per_day = num_valid_cycles / total_days if total_days > 0 else 0

            return {
                'total_cycles': num_valid_cycles,
                'avg_cycle_duration_minutes': round(avg_duration, 1),
                'avg_energy_per_cycle_kwh': round(avg_energy_kwh, 2),
                'cycles_per_day': round(cycles_per_day, 1)
            }

        except Exception as e:
            logger.error(f"Error analyzing hot water cycles from dataframe: {e}")
            return {
                'total_cycles': 0,
                'avg_cycle_duration_minutes': 0,
                'avg_energy_per_cycle_kwh': 0,
                'cycles_per_day': 0
            }

    def analyze_hot_water_cycles(self, time_range: str = '7d') -> Dict[str, Any]:
        """
        Analyze hot water heating cycles

        DEPRECATED: Use analyze_hot_water_cycles_from_df() with pre-fetched data for better performance
        KORRIGERAD: Använder nu korrekt effekt under varmvattencykler
        """
        try:
            metrics = ['switch_valve_status', 'hot_water_top', 'power_consumption']

            # Använd finare aggregering för varmvattenanalys
            df = self.query_metrics(metrics, time_range, aggregation_window='1m')
            
            if df.empty:
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }
            
            valve_df = df[df['name'] == 'switch_valve_status'].copy()
            power_df = df[df['name'] == 'power_consumption'].copy()
            
            if valve_df.empty:
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }
            
            valve_df = valve_df.sort_values('_time')
            power_df = power_df.sort_values('_time')
            
            # Detect cycles (transitions from 0 to 1)
            valve_df['prev_value'] = valve_df['_value'].shift(1)
            cycles_start = valve_df[(valve_df['_value'] == 1) & (valve_df['prev_value'] == 0)]
            
            num_cycles = len(cycles_start)
            
            logger.info(f"Hot water cycle detection for {time_range}:")
            logger.info(f"  Detected {num_cycles} valve transitions (0→1)")
            
            if num_cycles == 0:
                logger.info("  No valve transitions detected - växelventilen har inte slagit över till varmvatten")
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }
            
            # Calculate average cycle duration AND energy
            cycle_durations = []
            cycle_energies = []
            
            # MINIMUM DURATION FILTER - filtrera bort korta "blips" som inte är riktiga cykler
            MIN_CYCLE_DURATION_MINUTES = 5  # Varmvattencykler är typiskt 20-60 min, men acceptera från 5 min
            
            filtered_count = 0
            
            for start_time in cycles_start['_time']:
                after_start = valve_df[valve_df['_time'] > start_time]
                end_times = after_start[after_start['_value'] == 0]
                
                if not end_times.empty:
                    end_time = end_times.iloc[0]['_time']
                    duration_seconds = (end_time - start_time).total_seconds()
                    duration_minutes = duration_seconds / 60
                    
                    # FILTER: Skippa cykler kortare än minimum
                    if duration_minutes < MIN_CYCLE_DURATION_MINUTES:
                        filtered_count += 1
                        logger.debug(f"  ❌ FILTRERAD kort cykel kl {start_time.strftime('%H:%M:%S')}: {duration_minutes:.1f} min (< {MIN_CYCLE_DURATION_MINUTES} min)")
                        continue
                    
                    cycle_durations.append(duration_minutes)
                    
                    # KORRIGERING: Beräkna energi för DENNA specifika cykel
                    # Hämta effektdata under denna cykel
                    cycle_power = power_df[
                        (power_df['_time'] >= start_time) & 
                        (power_df['_time'] <= end_time)
                    ].copy()
                    
                    if not cycle_power.empty:
                        # Beräkna energi genom att integrera effekt över tid
                        cycle_power = cycle_power.sort_values('_time')
                        cycle_power['time_diff_hours'] = cycle_power['_time'].diff().dt.total_seconds() / 3600
                        cycle_power['time_diff_hours'] = cycle_power['time_diff_hours'].fillna(0)
                        
                        # Energy = Power (W) * Time (h) / 1000 = kWh
                        cycle_power['energy_kwh'] = (cycle_power['_value'] * cycle_power['time_diff_hours']) / 1000
                        
                        total_cycle_energy = cycle_power['energy_kwh'].sum()
                        cycle_energies.append(total_cycle_energy)

                        logger.debug(f"  ✅ GILTIG cykel kl {start_time.strftime('%H:%M:%S')}: {duration_minutes:.1f} min, {total_cycle_energy:.2f} kWh")
            
            # Antal giltiga cykler (efter filtrering)
            num_valid_cycles = len(cycle_durations)
            
            logger.info(f"  Totalt: {num_valid_cycles} giltiga cykler, {filtered_count} filtrerade (<{MIN_CYCLE_DURATION_MINUTES} min)")
            
            if num_valid_cycles == 0:
                logger.warning(f"⚠️  Inga giltiga varmvattencykler hittades - alla {filtered_count} cykler var < {MIN_CYCLE_DURATION_MINUTES} min!")
                logger.warning("   → Kontrollera växelventilsgrafen för att se vad som händer")
                return {
                    'total_cycles': 0,
                    'avg_cycle_duration_minutes': 0,
                    'avg_energy_per_cycle_kwh': 0,
                    'cycles_per_day': 0
                }
            
            avg_duration = np.mean(cycle_durations) if cycle_durations else 0
            avg_energy_kwh = np.mean(cycle_energies) if cycle_energies else 0
            
            # Calculate cycles per day - ANVÄNDER VERKLIG TID
            total_days = (valve_df['_time'].max() - valve_df['_time'].min()).total_seconds() / 86400
            cycles_per_day = num_valid_cycles / total_days if total_days > 0 else 0
            
            logger.info(f"Hot water analysis for {time_range}:")
            logger.info(f"  Total cycles: {num_valid_cycles} (filtered, min {MIN_CYCLE_DURATION_MINUTES} min)")
            logger.info(f"  Avg duration: {avg_duration:.1f} min")
            logger.info(f"  Avg energy: {avg_energy_kwh:.2f} kWh")
            logger.info(f"  Cycles/day: {cycles_per_day:.1f}")
            
            return {
                'total_cycles': num_valid_cycles,
                'avg_cycle_duration_minutes': round(avg_duration, 1),
                'avg_energy_per_cycle_kwh': round(avg_energy_kwh, 2),
                'cycles_per_day': round(cycles_per_day, 1)
            }
            
        except Exception as e:
            logger.error(f"Error analyzing hot water cycles: {e}")
            return {
                'total_cycles': 0,
                'avg_cycle_duration_minutes': 0,
                'avg_energy_per_cycle_kwh': 0,
                'cycles_per_day': 0
            }
    
    def get_alarm_status(self) -> Dict[str, Any]:
        """Get current alarm status with description (brand-aware)"""
        try:
            latest = self.get_latest_values()

            alarm_status = latest.get('alarm_status', {}).get('value', 0)
            alarm_code = int(latest.get('alarm_code', {}).get('value', 0))

            is_alarm = alarm_status > 0 or alarm_code > 0

            # Use brand-specific alarm codes
            alarm_description = self.alarm_codes.get(alarm_code, f"Okänd larmkod: {alarm_code}")
            
            # Hämta när larmet aktiverades
            if is_alarm:
                query = f'''
                    from(bucket: "{self.bucket}")
                        |> range(start: -7d)
                        |> filter(fn: (r) => r._measurement == "heatpump")
                        |> filter(fn: (r) => r.name == "alarm_code")
                        |> filter(fn: (r) => r._value > 0)
                        |> last()
                '''
                
                result = self.query_api.query_data_frame(query)
                
                if isinstance(result, list):
                    result = pd.concat(result, ignore_index=True)
                
                if not result.empty:
                    alarm_time = result.iloc[0]['_time']
                else:
                    alarm_time = None
            else:
                alarm_time = None
            
            return {
                'is_alarm': is_alarm,
                'alarm_code': alarm_code,
                'alarm_description': alarm_description,
                'alarm_time': alarm_time,
                'alarm_status_raw': alarm_status
            }
            
        except Exception as e:
            logger.error(f"Error getting alarm status: {e}")
            return {
                'is_alarm': False,
                'alarm_code': 0,
                'alarm_description': 'Inget larm',
                'alarm_time': None,
                'alarm_status_raw': 0
            }
    
    def get_event_log(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Get recent events (state changes) from the heat pump
        
        Events tracked:
        - Compressor ON/OFF
        - Brine pump ON/OFF
        - Radiator pump ON/OFF
        - Additional heater ON/OFF
        - Hot water cycle start/stop
        - Alarms
        """
        try:
            events = []
            
            # Hämta state changes för de senaste 24 timmarna
            metrics = [
                'compressor_status',
                'brine_pump_status', 
                'radiator_pump_status',
                'switch_valve_status',
                'additional_heat_percent',
                'alarm_code'
            ]
            
            logger.info(f"Fetching event log for {len(metrics)} metrics...")
            
            for metric in metrics:
                # Aggregera till 1-minuters intervall
                query = f'''
                    from(bucket: "{self.bucket}")
                        |> range(start: -24h)
                        |> filter(fn: (r) => r._measurement == "heatpump")
                        |> filter(fn: (r) => r.name == "{metric}")
                        |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
                        |> yield(name: "mean")
                '''
                
                logger.debug(f"Querying metric: {metric}")
                result = self.query_api.query_data_frame(query)
                
                if isinstance(result, list):
                    result = pd.concat(result, ignore_index=True)
                
                if result.empty:
                    logger.debug(f"No data for {metric}")
                    continue
                
                logger.info(f"Got {len(result)} rows for {metric}")
                
                result = result.sort_values('_time')
                
                # Detektera state changes
                result['prev_value'] = result['_value'].shift(1)
                
                # Räkna antal changes
                changes_detected = 0
                
                for idx, row in result.iterrows():
                    if pd.isna(row['prev_value']):
                        continue
                    
                    current = row['_value']
                    previous = row['prev_value']
                    timestamp = row['_time']
                    
                    # Kompressor
                    if metric == 'compressor_status':
                        if current > 0 and previous == 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Kompressor PÅ',
                                'type': 'info',
                                'icon': '🔄'
                            })
                            changes_detected += 1
                        elif current == 0 and previous > 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Kompressor AV',
                                'type': 'info',
                                'icon': '⏸️'
                            })
                            changes_detected += 1
                    
                    # Köldbärarpump
                    elif metric == 'brine_pump_status':
                        if current > 0 and previous == 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Köldbärarpump PÅ',
                                'type': 'info',
                                'icon': '💧'
                            })
                            changes_detected += 1
                        elif current == 0 and previous > 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Köldbärarpump AV',
                                'type': 'info',
                                'icon': '💧'
                            })
                            changes_detected += 1
                    
                    # Radiatorpump
                    elif metric == 'radiator_pump_status':
                        if current > 0 and previous == 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Radiatorpump PÅ',
                                'type': 'info',
                                'icon': '📡'
                            })
                            changes_detected += 1
                        elif current == 0 and previous > 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Radiatorpump AV',
                                'type': 'info',
                                'icon': '📡'
                            })
                            changes_detected += 1
                    
                    # Varmvattencykel
                    elif metric == 'switch_valve_status':
                        if current == 1 and previous == 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Varmvattencykel START',
                                'type': 'info',
                                'icon': '🚿'
                            })
                            changes_detected += 1
                        elif current == 0 and previous == 1:
                            events.append({
                                'time': timestamp,
                                'event': 'Varmvattencykel STOPP',
                                'type': 'info',
                                'icon': '🚿'
                            })
                            changes_detected += 1
                    
                    # Tillsattsvärme
                    elif metric == 'additional_heat_percent':
                        if current > 0 and previous == 0:
                            events.append({
                                'time': timestamp,
                                'event': f'Tillsattsvärme PÅ ({int(current)}%)',
                                'type': 'warning',
                                'icon': '🔥'
                            })
                            changes_detected += 1
                        elif current == 0 and previous > 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Tillsattsvärme AV',
                                'type': 'info',
                                'icon': '🔥'
                            })
                            changes_detected += 1
                        elif current > 0 and previous > 0 and abs(current - previous) > 10:
                            events.append({
                                'time': timestamp,
                                'event': f'Tillsattsvärme ändrad till {int(current)}%',
                                'type': 'warning',
                                'icon': '🔥'
                            })
                            changes_detected += 1
                    
                    # Larm (brand-aware)
                    elif metric == 'alarm_code':
                        if current > 0 and previous == 0:
                            alarm_desc = self.alarm_codes.get(int(current), f"Kod {int(current)}")
                            events.append({
                                'time': timestamp,
                                'event': f'LARM - {alarm_desc}',
                                'type': 'danger',
                                'icon': '⚠️'
                            })
                            changes_detected += 1
                        elif current == 0 and previous > 0:
                            events.append({
                                'time': timestamp,
                                'event': 'Larm återställt',
                                'type': 'success',
                                'icon': '✅'
                            })
                            changes_detected += 1
                
                logger.info(f"Detected {changes_detected} changes for {metric}")
            
            logger.info(f"Total events before sorting: {len(events)}")
            
            # Sortera efter tid (senaste först)
            events = sorted(events, key=lambda x: x['time'], reverse=True)
            
            # Begränsa till antal
            events = events[:limit]
            
            logger.info(f"Returning {len(events)} events after limit")
            
            return events
            
        except Exception as e:
            logger.error(f"Error getting event log: {e}")
            return []

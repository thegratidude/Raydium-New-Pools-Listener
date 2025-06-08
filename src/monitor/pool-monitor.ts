import { Connection, PublicKey } from '@solana/web3.js';
import { PoolSnapshot as AppPoolSnapshot, TrendDirection } from './types.js';
import { DatabaseManager, PoolSnapshot as DbPoolSnapshot } from './db-manager.js';
import { getCurrentTimestamp } from './db-schema.js';
import { Logger } from '@nestjs/common';

export class PoolMonitor {
    private readonly logger = new Logger(PoolMonitor.name);
    private updateCallback: ((snapshot: AppPoolSnapshot) => void) | null = null;
    private intervalId: NodeJS.Timeout | null = null;
    private lastSnapshot: AppPoolSnapshot | null = null;
    private db: DatabaseManager;

    constructor(
        private readonly poolId: string,
        private readonly updateInterval: number = 1000
    ) {
        this.db = new DatabaseManager();
    }

    async init() {
        await this.db.init();
    }

    public setOnUpdate(callback: (snapshot: AppPoolSnapshot) => void): void {
        this.updateCallback = callback;
    }

    public async start(): Promise<void> {
        if (this.intervalId) {
            this.logger.log(`Already monitoring pool ${this.poolId}`);
            return;
        }

        this.logger.log(`Starting monitoring for pool ${this.poolId}`);
        
        // Initial snapshot
        await this.updateState();

        // Set up interval for updates
        this.intervalId = setInterval(async () => {
            await this.updateState();
        }, this.updateInterval);
    }

    public async stop(): Promise<void> {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.logger.log(`Stopped monitoring pool ${this.poolId}`);
        }
    }

    private async updateState(): Promise<void> {
        try {
            // Get latest snapshot from database
            const snapshots = await this.db.getPoolSnapshots(this.poolId, undefined, undefined, 1);
            if (snapshots.length === 0) {
                this.logger.warn(`No snapshots found for pool ${this.poolId}`);
                return;
            }

            // Convert database snapshot to application snapshot
            const dbSnapshot = snapshots[0] as DbPoolSnapshot;
            const snapshot: AppPoolSnapshot = {
                pool_id: dbSnapshot.pool_id,
                timestamp: dbSnapshot.timestamp,
                base_reserve: dbSnapshot.base_reserve,
                quote_reserve: dbSnapshot.quote_reserve,
                base_reserve_raw: dbSnapshot.base_reserve_raw,
                quote_reserve_raw: dbSnapshot.quote_reserve_raw,
                price: dbSnapshot.price,
                price_change: dbSnapshot.price_change,
                tvl: dbSnapshot.tvl,
                volume_24h: dbSnapshot.volume_24h,
                volume_change: dbSnapshot.volume_change,
                buy_pressure: dbSnapshot.buy_pressure,
                sell_pressure: dbSnapshot.sell_pressure,
                market_pressure: dbSnapshot.market_pressure,
                pressure_direction: dbSnapshot.pressure_direction as TrendDirection,
                pressure_strength: dbSnapshot.pressure_strength,
                pressure_severity: dbSnapshot.pressure_severity,
                trade_count: dbSnapshot.trade_count,
                trade_volume: dbSnapshot.trade_volume,
                liquidity_change: dbSnapshot.liquidity_change,
                price_impact: dbSnapshot.price_impact,
                suspicious: dbSnapshot.suspicious,
                risk_score: dbSnapshot.risk_score
            };
            
            // Calculate changes if we have a previous snapshot
            if (this.lastSnapshot) {
                snapshot.price_change = (snapshot.price - this.lastSnapshot.price) / this.lastSnapshot.price;
                snapshot.volume_change = (snapshot.volume_24h - this.lastSnapshot.volume_24h) / this.lastSnapshot.volume_24h;
                snapshot.liquidity_change = (
                    (snapshot.base_reserve + snapshot.quote_reserve) - 
                    (this.lastSnapshot.base_reserve + this.lastSnapshot.quote_reserve)
                ) / (this.lastSnapshot.base_reserve + this.lastSnapshot.quote_reserve);
            }

            // Update market pressure metrics
            this.updateMarketPressure(snapshot);

            // Store the snapshot
            this.lastSnapshot = snapshot;

            // Call the update callback if set
            if (this.updateCallback) {
                this.updateCallback(snapshot);
            }

        } catch (err) {
            this.logger.error(`Error updating state for pool ${this.poolId}:`, err);
        }
    }

    private updateMarketPressure(snapshot: AppPoolSnapshot): void {
        // Calculate buy/sell pressure based on recent trades
        const buyVolume = snapshot.trade_volume * (1 + snapshot.price_change);
        const sellVolume = snapshot.trade_volume * (1 - snapshot.price_change);
        
        snapshot.buy_pressure = buyVolume / (buyVolume + sellVolume);
        snapshot.sell_pressure = sellVolume / (buyVolume + sellVolume);
        
        // Overall market pressure
        snapshot.market_pressure = snapshot.buy_pressure - snapshot.sell_pressure;
        
        // Determine pressure direction and strength
        snapshot.pressure_direction = snapshot.market_pressure > 0 ? TrendDirection.UP : TrendDirection.DOWN;
        snapshot.pressure_strength = Math.abs(snapshot.market_pressure);
        
        // Calculate pressure severity based on volume and price impact
        snapshot.pressure_severity = snapshot.pressure_strength * snapshot.price_impact;
        
        // Update risk score
        snapshot.risk_score = this.calculateRiskScore(snapshot);
    }

    private calculateRiskScore(snapshot: AppPoolSnapshot): number {
        let score = 0;
        
        // Price volatility
        score += Math.abs(snapshot.price_change) * 10;
        
        // Volume concentration
        if (snapshot.volume_24h > 0) {
            const volumeConcentration = snapshot.trade_volume / snapshot.volume_24h;
            score += volumeConcentration * 5;
        }
        
        // Market pressure extremes
        score += snapshot.pressure_strength * 3;
        
        // Price impact
        score += snapshot.price_impact * 2;
        
        // Suspicious activity
        if (snapshot.suspicious) {
            score += 5;
        }
        
        return Math.min(100, score);
    }
}
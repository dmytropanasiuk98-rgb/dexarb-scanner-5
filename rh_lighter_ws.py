import asyncio
import aiohttp
import json
import logging
from typing import Dict, Tuple, Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("RHLighterWS")

WS_URL = "wss://api.rh.lighter.xyz/stream?readonly=true"

RH_SYMBOL_TO_ID = {
    'ETH': 0, 'BTC': 1, 'HYPE': 2, 'SOL': 3, 'ZEC': 4, 'LIT': 5, 'XRP': 6, 'NEAR': 7,
    'VVV': 8, 'SUI': 9, 'AAPL': 10, 'AMZN': 11, 'GOOGL': 12, 'META': 13, 'MSFT': 14,
    'NVDA': 15, 'TSLA': 16, 'ORCL': 17, 'SPCX': 18, 'BABA': 19, 'BE': 20, 'USAR': 21,
    'USO': 22, 'COIN': 23, 'CRCL': 24, 'QQQ': 25, 'SPY': 26, 'SGOV': 27, 'SLV': 28,
    'AMD': 29, 'INTC': 30, 'MU': 31, 'SNDK': 32, 'CRWV': 33, 'PLTR': 34, 'SOXL': 35,
    'CASHCAT': 36, 'SKHY': 37, 'ANTHROPIC': 38, 'ANSEM': 39
}

class RHLighterClient:
    def __init__(self):
        self.ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self.session: Optional[aiohttp.ClientSession] = None
        self.prices: Dict[str, Tuple[float, float]] = {} # symbol -> (bid, ask)
        self.funding_rates: Dict[str, float] = {} # symbol -> funding_rate_pct
        self.running = False

    async def start(self):
        """Starts the background WebSocket task."""
        self.running = True
        self.session = aiohttp.ClientSession()
        asyncio.create_task(self._connect_loop())

    async def stop(self):
        """Stops the client."""
        self.running = False
        if self.ws:
            await self.ws.close()
        if self.session:
            await self.session.close()

    async def _connect_loop(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://rh.lighter.xyz"
        }
        while self.running:
            try:
                logger.info(f"Connecting to RH Lighter WS: {WS_URL}")
                async with self.session.ws_connect(WS_URL, headers=headers) as ws:
                    self.ws = ws
                    logger.info("Connected to Robinhood Lighter WS")
                    
                    # Subscribe to market_stats/all
                    sub_msg = {"type": "subscribe", "channel": "market_stats/all"}
                    await ws.send_json(sub_msg)

                    async for msg in ws:
                        if not self.running: break
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            await self._handle_msg(json.loads(msg.data))
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            logger.error(f"RH Lighter WS Error: {ws.exception()}")
                            break
            except Exception as e:
                logger.error(f"RH Lighter Connection error: {e}")
                await asyncio.sleep(3)

    async def _handle_msg(self, data: dict):
        msg_type = data.get("type")
        if msg_type in ["subscribed/market_stats", "update/market_stats"]:
            stats = data.get("market_stats", {})
            if isinstance(stats, dict):
                # Handles dict of market_id -> stat_obj
                for m_id, item in stats.items():
                    if isinstance(item, dict):
                        sym = item.get("symbol")
                        bid_str = item.get("best_bid_price") or item.get("mark_price") or item.get("last_trade_price")
                        ask_str = item.get("best_ask_price") or item.get("mark_price") or item.get("last_trade_price")
                        fr_str = item.get("current_funding_rate") or item.get("funding_rate")
                        if sym:
                            if bid_str and ask_str:
                                try:
                                    bid = float(bid_str)
                                    ask = float(ask_str)
                                    if bid > 0 and ask > 0:
                                        self.prices[sym] = (bid, ask)
                                except ValueError:
                                    pass
                            if fr_str is not None:
                                try:
                                    self.funding_rates[sym] = float(fr_str) # 1hr funding rate % (e.g. 0.0012 = 0.0012%)
                                except ValueError:
                                    pass
            elif isinstance(stats, list):
                for item in stats:
                    if isinstance(item, dict):
                        sym = item.get("symbol")
                        bid_str = item.get("best_bid_price") or item.get("mark_price")
                        ask_str = item.get("best_ask_price") or item.get("mark_price")
                        fr_str = item.get("current_funding_rate") or item.get("funding_rate")
                        if sym:
                            if bid_str and ask_str:
                                try:
                                    self.prices[sym] = (float(bid_str), float(ask_str))
                                except ValueError:
                                    pass
                            if fr_str is not None:
                                try:
                                    self.funding_rates[sym] = float(fr_str)
                                except ValueError:
                                    pass

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (best_bid, best_ask) from live WS cache."""
        return self.prices.get(symbol, (0.0, 0.0))

    def get_funding(self, symbol: str) -> float:
        """Returns annualized funding rate APR percentage (1hr rate % * 8760 hours/year)."""
        rate_1h_pct = self.funding_rates.get(symbol, 0.0)
        return rate_1h_pct * 8760.0

client = RHLighterClient()

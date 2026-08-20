import asyncio
import aiohttp
import json
import logging
import time
from typing import Dict, Tuple, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("LighterWS")

WS_URL = "wss://mainnet.zklighter.elliot.ai/stream"

# Symbol to Market ID mapping from Lighter API
# Extracted from lighter_raw.json - all perpetual markets
SYMBOL_TO_ID = {
    "0G": 84,
    "1000BONK": 18,
    "1000FLOKI": 19,
    "1000PEPE": 4,
    "1000SHIB": 17,
    "1000TOSHI": 81,
    "2Z": 88,
    "AAPL": 113,
    "AAVE": 27,
    "ADA": 39,
    "AERO": 65,
    "AI16Z": 22,
    "AMZN": 114,
    "APEX": 86,
    "APT": 31,
    "ARB": 50,
    "ASTER": 83,
    "AUDUSD": 106,
    "AVAX": 9,
    "AVNT": 82,
    "BCH": 58,
    "BERA": 20,
    "BMNR": 123,
    "BNB": 25,
    "BTC": 1,
    "CC": 101,
    "COIN": 109,
    "CRCL": 121,
    "CRO": 73,
    "CRV": 36,
    "DASH": 127,
    "DOGE": 3,
    "DOLO": 75,
    "DOT": 11,
    "DUSK": 125,
    "DYDX": 62,
    "EDEN": 89,
    "EIGEN": 49,
    "ENA": 29,
    "ETH": 0,
    "ETHFI": 64,
    "EURUSD": 96,
    "FARTCOIN": 21,
    "FF": 87,
    "FIL": 103,
    "FOGO": 124,
    "GBPUSD": 97,
    "GMX": 61,
    "GOOGL": 116,
    "GRASS": 52,
    "HBAR": 59,
    "HOOD": 108,
    "HYPE": 24,
    "ICP": 102,
    "IP": 34,
    "JUP": 26,
    "KAITO": 33,
    "LAUNCHCOIN": 54,
    "LDO": 46,
    "LINEA": 76,
    "LINK": 8,
    "LIT": 120,
    "LTC": 35,
    "MEGA": 94,
    "MET": 95,
    "META": 117,
    "MKR": 28,
    "MNT": 63,
    "MON": 91,
    "MORPHO": 68,
    "MSFT": 115,
    "MSTR": 122,
    "MYX": 80,
    "NEAR": 10,
    "NMR": 74,
    "NVDA": 110,
    "NZDUSD": 107,
    "ONDO": 38,
    "OP": 55,
    "PAXG": 48,
    "PENDLE": 37,
    "PENGU": 47,
    "PLTR": 111,
    "POL": 14,
    "POPCAT": 23,
    "PROVE": 57,
    "PUMP": 45,
    "PYTH": 78,
    "QQQ": 129,
    "RESOLV": 51,
    "RIVER": 126,
    "S": 40,
    "SEI": 32,
    "SKY": 79,
    "SOL": 2,
    "SPX": 42,
    "SPY": 128,
    "STABLE": 118,
    "STBL": 85,
    "STRK": 104,
    "SUI": 16,
    "SYRUP": 44,
    "TAO": 13,
    "TIA": 67,
    "TON": 12,
    "TRUMP": 15,
    "TRX": 43,
    "TSLA": 112,
    "UNI": 30,
    "USDCAD": 100,
    "USDCHF": 99,
    "USDJPY": 98,
    "USDKRW": 105,
    "USELESS": 66,
    "VIRTUAL": 41,
    "VVV": 69,
    "WIF": 5,
    "WLD": 6,
    "WLFI": 72,
    "XAG": 93,
    "XAU": 92,
    "XLM": 119,
    "XMR": 77,
    "XPL": 71,
    "XRP": 7,
    "YZY": 70,
    "ZEC": 90,
    "ZK": 56,
    "ZORA": 53,
    "ZRO": 60,
    # Legacy mapping for VR (VIRTUAL is the correct symbol)
    "VR": 41,
    "PEPE": 4,  # Alias for 1000PEPE
}

class LighterClient:
    def __init__(self):
        self.ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self.session: Optional[aiohttp.ClientSession] = None
        self.order_books: Dict[str, Dict] = {} # symbol -> {bids: [], asks: []}
        self.funding_rates: Dict[str, float] = {} # symbol -> funding_rate_pct
        self.running = False
        self._ready = False

    async def start(self):
        """Starts the background WebSocket task and funding rate poller."""
        self.running = True
        self.session = aiohttp.ClientSession()
        asyncio.create_task(self._connect_loop())
        asyncio.create_task(self._poll_funding_loop())

    async def stop(self):
        """Stops the client."""
        self.running = False
        if self.ws:
            await self.ws.close()
        if self.session:
            await self.session.close()

    async def _poll_funding_loop(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        while self.running:
            try:
                if self.session and not self.session.closed:
                    url = "https://mainnet.zklighter.elliot.ai/api/v1/funding-rates"
                    async with self.session.get(url, headers=headers, timeout=10) as r:
                        if r.status == 200:
                            data = await r.json()
                            rates = data.get("funding_rates", [])
                            for item in rates:
                                if item.get("exchange") == "lighter":
                                    sym = item.get("symbol")
                                    rate_val = float(item.get("rate", 0))
                                    # Convert 8h fraction to Annualized APR % (matching Lighter UI Yearly APR)
                                    apr = (rate_val / 8.0) * 8760.0 * 100.0
                                    if sym:
                                        self.funding_rates[sym] = round(apr, 4)
            except Exception as e:
                logger.debug(f"Lighter funding poll error: {e}")
            await asyncio.sleep(30)

    async def _connect_loop(self):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Origin": "https://app.lighter.xyz"
        }
        while self.running:
            try:
                async with self.session.ws_connect(WS_URL, headers=headers) as ws:
                    self.ws = ws
                    logger.info("Connected to Lighter WS")
                    self._ready = True
                    
                    # Subscribe to all known symbols
                    for sym, mid in SYMBOL_TO_ID.items():
                        await self.subscribe(mid)
                        # Small delay to avoid rate limits if any
                        await asyncio.sleep(0.05)

                    async for msg in ws:
                        if not self.running: break
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            await self._handle_msg(json.loads(msg.data))
                        elif msg.type == aiohttp.WSMsgType.ERROR:
                            logger.error(f"WS Error: {ws.exception()}")
                            break
            except Exception as e:
                logger.error(f"Connection error: {e}")
                self._ready = False
                await asyncio.sleep(5) # Reconnect delay

    async def subscribe(self, market_id: int):
        if not self.ws: return
        msg = {"type": "subscribe", "channel": f"order_book/{market_id}"}
        await self.ws.send_json(msg)

    async def _handle_msg(self, data: dict):
        # Handle snapshot: "type": "subscribed/order_book"
        # Handle update: "type": "update/order_book"
        
        msg_type = data.get("type")
        channel = data.get("channel", "")
        
        if msg_type in ["subscribed/order_book", "update/order_book"]:
            # Channel format can be "order_book/1" or "order_book:1"
            try:
                # Handle both delimiters
                market_id_str = channel.replace(":", "/").split("/")[-1]
                market_id = int(market_id_str)
                # Reverse lookup symbol
                symbol = next((k for k, v in SYMBOL_TO_ID.items() if v == market_id), None)
                
                if symbol and "order_book" in data:
                    ob = data["order_book"]
                    # Lighter sends "bids" and "asks" as lists of {price, size} strings
                    # We need to parse them. 
                    # NOTE: Snapshots are full, updates might be partial? 
                    # The search result said "complete snapshot then incremental".
                    # For a simple dashboard, assume we just grab the latest best bid/ask from the update 
                    # IF the update contains the top of the book. 
                    # To be perfectly correct we need to maintain a local orderbook state.
                    # But for "polling" current price, using the latest non-empty update is often "good enough" for a dashboard,
                    # HOWEVER, Lighter updates are diffs. If the best price doesn't change, it might not be in the update.
                    # We must maintain state.
                    
                    self._update_local_book(symbol, ob, is_snapshot=(msg_type == "subscribed/order_book"))
            except Exception as e:
                logger.error(f"Parse error: {e}")

    def _update_local_book(self, symbol: str, data: dict, is_snapshot: bool):
        if symbol not in self.order_books or is_snapshot:
            # Initialize or reset
            self.order_books[symbol] = {"bids": {}, "asks": {}}
        
        book = self.order_books[symbol]
        
        # Process Bids
        for item in data.get("bids", []):
            price = float(item["price"])
            size = float(item["size"])
            if size == 0:
                book["bids"].pop(price, None)
            else:
                book["bids"][price] = size
                
        # Process Asks
        for item in data.get("asks", []):
            price = float(item["price"])
            size = float(item["size"])
            if size == 0:
                book["asks"].pop(price, None)
            else:
                book["asks"][price] = size

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (best_bid, best_ask)"""
        if symbol not in self.order_books:
            return 0.0, 0.0
        
        book = self.order_books[symbol]
        
        bids = sorted(book["bids"].keys(), reverse=True)
        asks = sorted(book["asks"].keys())
        
        best_bid = bids[0] if bids else 0.0
        best_ask = asks[0] if asks else 0.0
        
        return best_bid, best_ask

    def get_funding(self, symbol: str) -> float:
        """Returns funding rate percentage for symbol"""
        if symbol in self.funding_rates:
            return self.funding_rates[symbol]
        return 0.0

# Global instance
client = LighterClient()

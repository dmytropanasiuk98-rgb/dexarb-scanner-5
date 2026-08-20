import asyncio
import aiohttp
import json
import logging
from typing import Dict, Tuple, Optional, Set

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ExtendedDEX")

EXTENDED_BASE_URL = "https://api.starknet.extended.exchange/api/v1"

class ExtendedClient:
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.prices: Dict[str, Tuple[float, float]] = {}  # symbol -> (bid, ask)
        self.funding_rates: Dict[str, float] = {}  # symbol -> funding_rate_apr_pct
        self.running = False

    async def start(self):
        """Starts background polling for Extended DEX stats."""
        self.running = True
        asyncio.create_task(self._poll_loop())
        asyncio.create_task(self._orderbook_poll_loop())

    async def stop(self):
        """Stops the client."""
        self.running = False
        if self.session and not self.session.closed:
            await self.session.close()

    async def _poll_loop(self):
        while self.running:
            try:
                if self.session is None or self.session.closed:
                    conn = aiohttp.TCPConnector(ssl=False)
                    self.session = aiohttp.ClientSession(connector=conn, headers={'User-Agent': 'Mozilla/5.0'})

                async with self.session.get(f"{EXTENDED_BASE_URL}/info/markets", timeout=5) as r:
                    if r.status == 200:
                        data = await r.json()
                        markets = data.get("data", [])
                        new_prices = {}
                        new_funding = {}
                        for item in markets:
                            name = item.get("name", "")
                            if "-" in name:
                                sym = name.split("-")[0].upper()
                                stats = item.get("marketStats") or item.get("stats") or {}
                                b_val = stats.get("bidPrice")
                                a_val = stats.get("askPrice")
                                if b_val and a_val:
                                    try:
                                        bid = float(b_val)
                                        ask = float(a_val)
                                        if bid > 0 and ask > 0 and ask >= bid:
                                            new_prices[sym] = (bid, ask)
                                    except ValueError:
                                        pass
                                fr_str = stats.get("fundingRate")
                                if fr_str is not None:
                                    try:
                                        new_funding[sym] = float(fr_str) * 8760.0 * 100.0
                                    except ValueError:
                                        pass
                        if new_prices:
                            self.prices.update(new_prices)
                        if new_funding:
                            self.funding_rates.update(new_funding)
            except Exception as e:
                logger.error(f"Extended DEX poll error: {e}")
                if self.session and not self.session.closed:
                    await self.session.close()
                    self.session = None
            await asyncio.sleep(0.8)

    async def fetch_orderbook(self, sym: str) -> Tuple[float, float]:
        """Fetches live orderbook (bid, ask) for a specific symbol."""
        try:
            if self.session is None or self.session.closed:
                conn = aiohttp.TCPConnector(ssl=False)
                self.session = aiohttp.ClientSession(connector=conn, headers={'User-Agent': 'Mozilla/5.0'})
            
            url = f"{EXTENDED_BASE_URL}/info/markets/{sym.upper()}-USD/orderbook"
            async with self.session.get(url, timeout=3) as r:
                if r.status == 200:
                    res = await r.json()
                    data = res.get("data", {})
                    bids = data.get("bid", [])
                    asks = data.get("ask", [])
                    if bids and asks:
                        bid = float(bids[0]["price"])
                        ask = float(asks[0]["price"])
                        if bid > 0 and ask > 0 and ask >= bid:
                            self.prices[sym.upper()] = (bid, ask)
                            return bid, ask
        except Exception as e:
            logger.debug(f"Extended fetch orderbook error for {sym}: {e}")
        return self.prices.get(sym.upper(), (0.0, 0.0))

    async def _orderbook_poll_loop(self):
        """Poll orderbook for top active symbols every 1.5s."""
        top_symbols = ["BTC", "ETH", "SOL", "ZEC", "HYPE", "QQQ", "SPY", "GOOGL", "TSLA", "NVDA", "AMD", "MU", "SUI", "XRP", "ORCL"]
        while self.running:
            try:
                tasks = [self.fetch_orderbook(sym) for sym in top_symbols]
                await asyncio.gather(*tasks, return_exceptions=True)
            except Exception as e:
                logger.error(f"Extended orderbook poll error: {e}")
            await asyncio.sleep(1.5)

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (best_bid, best_ask) from live RAM cache."""
        return self.prices.get(symbol.upper(), (0.0, 0.0))

    def get_funding(self, symbol: str) -> float:
        """Returns funding rate APR percentage."""
        return self.funding_rates.get(symbol.upper(), 0.0)

    def get_symbols(self) -> Set[str]:
        """Returns set of available symbols."""
        return set(self.funding_rates.keys())

client = ExtendedClient()

import asyncio
import aiohttp
import json
import logging
from typing import Dict, Tuple, Optional, Set

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Variational")

VARIATIONAL_STATS_URL = "https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats"

class VariationalClient:
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.prices: Dict[str, Tuple[float, float]] = {}  # symbol -> (bid, ask)
        self.funding_rates: Dict[str, float] = {}  # symbol -> funding_rate_pct
        self.running = False

    async def start(self):
        """Starts background polling for Variational stats."""
        self.running = True
        asyncio.create_task(self._poll_loop())

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
                
                async with self.session.get(VARIATIONAL_STATS_URL, timeout=5) as r:
                    if r.status == 200:
                        data = await r.json()
                        listings = data.get("listings", [])
                        new_prices = {}
                        new_funding = {}
                        for item in listings:
                            tkr = item.get("ticker")
                            quotes = item.get("quotes") or {}
                            base = quotes.get("base") or quotes.get("size_1k") or {}
                            
                            bid_val = base.get("bid")
                            ask_val = base.get("ask")
                            fr_str = item.get("funding_rate")
                            
                            if tkr and bid_val and ask_val:
                                sym_upper = tkr.upper()
                                try:
                                    bid = float(bid_val)
                                    ask = float(ask_val)
                                    if bid > 0 and ask > 0 and ask >= bid:
                                        new_prices[sym_upper] = (bid, ask)
                                except ValueError:
                                    pass
                            
                            if tkr and fr_str is not None:
                                sym_upper = tkr.upper()
                                try:
                                    new_funding[sym_upper] = float(fr_str)
                                except ValueError:
                                    pass
                        
                        if new_prices:
                            self.prices.update(new_prices)
                        if new_funding:
                            self.funding_rates.update(new_funding)
            except Exception as e:
                logger.error(f"Variational poll error: {e}")
                if self.session and not self.session.closed:
                    await self.session.close()
                    self.session = None
            await asyncio.sleep(1.5)

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (best_bid, best_ask) from live RAM cache."""
        return self.prices.get(symbol.upper(), (0.0, 0.0))

    def get_funding(self, symbol: str) -> float:
        """Returns funding rate percentage."""
        return self.funding_rates.get(symbol.upper(), 0.0)

    def get_symbols(self) -> Set[str]:
        """Returns set of available symbols."""
        return set(self.prices.keys())

client = VariationalClient()

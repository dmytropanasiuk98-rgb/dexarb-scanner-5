import asyncio
import requests
import logging
from typing import Dict, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("RiseX")

RISEX_MARKETS_URL = "https://api.rise.trade/v1/markets"

class RiseXClient:
    def __init__(self):
        self.prices: Dict[str, Tuple[float, float]] = {}  # symbol -> (bid, ask)
        self.funding_rates: Dict[str, float] = {}  # symbol -> funding_rate_apr_pct
        self.running = False

    async def start(self):
        """Starts background polling for RiseX stats."""
        self.running = True
        asyncio.create_task(self._poll_loop())

    async def stop(self):
        """Stops the client."""
        self.running = False

    def _fetch_sync(self):
        headers = {
            "User-Agent": "Mozilla/5.0"
        }
        try:
            r = requests.get(RISEX_MARKETS_URL, headers=headers, timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.debug(f"RiseX sync fetch error: {e}")
        return None

    async def _poll_loop(self):
        while self.running:
            try:
                data = await asyncio.to_thread(self._fetch_sync)
                if data and "data" in data:
                    markets = data.get("data", {}).get("markets", [])
                    new_prices = {}
                    new_funding = {}

                    for m in markets:
                        sym_raw = m.get("base_asset_symbol", "")
                        if not sym_raw:
                            sym_raw = m.get("display_name", "")
                        
                        sym = sym_raw.split('/')[0].upper().strip()
                        if not sym:
                            continue

                        mark_str = m.get("mark_price") or m.get("last_price")
                        if mark_str:
                            try:
                                price = float(mark_str)
                                if price > 0:
                                    bid = round(price * 0.9999, 4)
                                    ask = round(price * 1.0001, 4)
                                    new_prices[sym] = (bid, ask)
                                    if sym in ["XAU", "PAXG"]:
                                        new_prices["GOLD"] = (bid, ask)
                            except ValueError:
                                pass

                        fr_str = m.get("current_funding_rate") or m.get("funding_rate_8h")
                        if fr_str is not None:
                            try:
                                fr_val = float(fr_str)
                                apr = fr_val * 8760.0 * 100.0
                                new_funding[sym] = round(apr, 4)
                                if sym in ["XAU", "PAXG"]:
                                    new_funding["GOLD"] = round(apr, 4)
                            except ValueError:
                                pass

                    if new_prices:
                        self.prices.update(new_prices)
                    if new_funding:
                        self.funding_rates.update(new_funding)
            except Exception as e:
                logger.debug(f"RiseX poll loop error: {e}")
            await asyncio.sleep(1.5)

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (bid, ask) for symbol."""
        sym_upper = symbol.upper()
        if sym_upper in self.prices:
            return self.prices[sym_upper]
        if sym_upper == "GOLD" and "XAU" in self.prices:
            return self.prices["XAU"]
        return 0.0, 0.0

    def get_funding(self, symbol: str) -> float:
        """Returns Annualized APR % for symbol."""
        sym_upper = symbol.upper()
        if sym_upper in self.funding_rates:
            return self.funding_rates[sym_upper]
        if sym_upper == "GOLD" and "XAU" in self.funding_rates:
            return self.funding_rates["XAU"]
        return 0.0

client = RiseXClient()

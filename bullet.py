import asyncio
import requests
import logging
from typing import Dict, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Bullet")

BULLET_PREMIUM_INDEX_URL = "https://tradingapi.bullet.xyz/fapi/v1/premiumIndex"

class BulletClient:
    def __init__(self):
        self.prices: Dict[str, Tuple[float, float]] = {}  # symbol -> (bid, ask)
        self.funding_rates: Dict[str, float] = {}  # symbol -> funding_rate_apr_pct
        self.running = False

    async def start(self):
        """Starts background polling for Bullet DEX stats."""
        self.running = True
        asyncio.create_task(self._poll_loop())

    async def stop(self):
        """Stops the client."""
        self.running = False

    def _fetch_sync(self):
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json"
        }
        try:
            r = requests.get(BULLET_PREMIUM_INDEX_URL, headers=headers, timeout=5)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            logger.debug(f"Bullet sync fetch error: {e}")
        return None

    async def _poll_loop(self):
        while self.running:
            try:
                items = await asyncio.to_thread(self._fetch_sync)
                if items and isinstance(items, list):
                    new_prices = {}
                    new_funding = {}

                    for item in items:
                        sym_raw = item.get("symbol", "")
                        if not sym_raw:
                            continue
                        
                        base_sym = sym_raw.split('-')[0].upper().strip()
                        if not base_sym:
                            continue

                        # Alias mappings for universal scanner compatibility
                        aliases = [base_sym]
                        if base_sym == "US500":
                            aliases.append("SPY")
                        elif base_sym in ["GOLD", "XAU"]:
                            aliases.extend(["GOLD", "XAU"])
                        elif base_sym in ["SILVER", "XAG"]:
                            aliases.extend(["SILVER", "XAG"])

                        mark_str = item.get("markPrice") or item.get("indexPrice")
                        if mark_str:
                            try:
                                price = float(mark_str)
                                if price > 0:
                                    bid = round(price * 0.9999, 4)
                                    ask = round(price * 1.0001, 4)
                                    for s in aliases:
                                        new_prices[s] = (bid, ask)
                            except ValueError:
                                pass

                        fr_str = item.get("lastFundingRate") or item.get("estimatedFundingRate")
                        if fr_str is not None:
                            try:
                                fr_val = float(fr_str)
                                # Bullet lastFundingRate is 8-hour rate fraction -> convert to Annualized APR %
                                apr = (fr_val / 8.0) * 8760.0 * 100.0
                                for s in aliases:
                                    new_funding[s] = round(apr, 4)
                            except ValueError:
                                pass

                    if new_prices:
                        self.prices.update(new_prices)
                    if new_funding:
                        self.funding_rates.update(new_funding)
            except Exception as e:
                logger.debug(f"Bullet poll loop error: {e}")
            await asyncio.sleep(1.5)

    def get_price(self, symbol: str) -> Tuple[float, float]:
        """Returns (bid, ask) for symbol."""
        sym_upper = symbol.upper()
        if sym_upper in self.prices:
            return self.prices[sym_upper]
        if sym_upper == "GOLD" and "XAU" in self.prices:
            return self.prices["XAU"]
        if sym_upper == "SPY" and "US500" in self.prices:
            return self.prices["US500"]
        return 0.0, 0.0

    def get_funding(self, symbol: str) -> float:
        """Returns Annualized APR % for symbol."""
        sym_upper = symbol.upper()
        if sym_upper in self.funding_rates:
            return self.funding_rates[sym_upper]
        if sym_upper == "GOLD" and "XAU" in self.funding_rates:
            return self.funding_rates["XAU"]
        if sym_upper == "SPY" and "US500" in self.funding_rates:
            return self.funding_rates["US500"]
        return 0.0

client = BulletClient()

"""Kite Connect order executor — places REAL orders on Zerodha."""
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from kiteconnect import KiteConnect

logger = logging.getLogger(__name__)


class KiteExecutor:
    """
    Executes real orders through the Kite Connect API.

    Handles:
    - Order placement (market, limit, SL, SL-M)
    - Order modification
    - Order cancellation
    - Order status tracking
    """

    def __init__(self, kite_client: KiteConnect):
        self._kite = kite_client
        self._order_map: dict[str, str] = {}  # internal_id -> broker_order_id

    def place_order(
        self,
        symbol: str,
        exchange: str,
        side: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float | None = None,
        trigger_price: float | None = None,
        product: str = "MIS",
        variety: str = "regular",
    ) -> dict[str, Any]:
        """
        Place a real order on Zerodha.

        Returns dict with 'order_id' and 'status'.
        """
        try:
            params = {
                "tradingsymbol": symbol,
                "exchange": exchange,
                "transaction_type": side.upper(),
                "quantity": quantity,
                "order_type": order_type.upper(),
                "product": product.upper(),
                "variety": variety,
            }

            if order_type.upper() == "LIMIT" and price:
                params["price"] = price
            elif order_type.upper() == "SL":
                if trigger_price:
                    params["trigger_price"] = trigger_price
                if price:
                    params["price"] = price
            elif order_type.upper() == "SL-M":
                if trigger_price:
                    params["trigger_price"] = trigger_price

            broker_order_id = self._kite.place_order(**params)
            logger.info(
                "Order placed: %s %s %s x%d -> order_id=%s",
                side, symbol, order_type, quantity, broker_order_id,
            )
            return {
                "order_id": str(broker_order_id),
                "status": "placed",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            logger.error("Order placement failed: %s %s x%d: %s", side, symbol, quantity, e)
            return {
                "order_id": None,
                "status": "failed",
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

    def modify_order(
        self,
        order_id: str,
        quantity: int | None = None,
        price: float | None = None,
        trigger_price: float | None = None,
        order_type: str | None = None,
        variety: str = "regular",
    ) -> dict:
        """Modify an existing order."""
        try:
            params: dict[str, Any] = {"order_id": order_id, "variety": variety}
            if quantity is not None:
                params["quantity"] = quantity
            if price is not None:
                params["price"] = price
            if trigger_price is not None:
                params["trigger_price"] = trigger_price
            if order_type is not None:
                params["order_type"] = order_type

            self._kite.modify_order(**params)
            logger.info("Order modified: %s", order_id)
            return {"status": "modified", "order_id": order_id}
        except Exception as e:
            logger.error("Order modify failed: %s: %s", order_id, e)
            return {"status": "failed", "error": str(e)}

    def cancel_order(self, order_id: str, variety: str = "regular") -> dict:
        """Cancel an existing order."""
        try:
            self._kite.cancel_order(variety=variety, order_id=order_id)
            logger.info("Order cancelled: %s", order_id)
            return {"status": "cancelled", "order_id": order_id}
        except Exception as e:
            logger.error("Order cancel failed: %s: %s", order_id, e)
            return {"status": "failed", "error": str(e)}

    def get_order_status(self, order_id: str) -> dict | None:
        """Get the latest status of an order."""
        try:
            history = self._kite.order_history(order_id=order_id)
            if history:
                return history[-1]  # Latest status
            return None
        except Exception as e:
            logger.error("Order status fetch failed: %s: %s", order_id, e)
            return None

    def get_all_orders(self) -> list:
        """Get all orders for the day."""
        try:
            return self._kite.orders() or []
        except Exception as e:
            logger.error("Failed to fetch orders: %s", e)
            return []

    def get_positions(self) -> dict:
        """Get all positions from Kite."""
        try:
            return self._kite.positions() or {"net": [], "day": []}
        except Exception as e:
            logger.error("Failed to fetch positions: %s", e)
            return {"net": [], "day": []}

    def square_off_all(self, exchange: str = "NSE", product: str = "MIS") -> list[dict]:
        """Emergency square off: close ALL open positions."""
        results = []
        try:
            positions = self._kite.positions()
            for pos in positions.get("net", []):
                qty = pos.get("quantity", 0)
                if qty == 0:
                    continue

                side = "SELL" if qty > 0 else "BUY"
                abs_qty = abs(qty)
                symbol = pos.get("tradingsymbol", "")
                exch = pos.get("exchange", exchange)

                result = self.place_order(
                    symbol=symbol,
                    exchange=exch,
                    side=side,
                    quantity=abs_qty,
                    order_type="MARKET",
                    product=pos.get("product", product),
                )
                result["symbol"] = symbol
                result["action"] = f"{side} {abs_qty}"
                results.append(result)

            logger.warning("EMERGENCY SQUARE OFF: %d positions closed", len(results))
        except Exception as e:
            logger.error("Square off failed: %s", e)
            results.append({"status": "failed", "error": str(e)})

        return results

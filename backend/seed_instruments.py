"""Seed the instruments table with common NSE/BSE instruments."""
import asyncio
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

INSTRUMENTS = [
    # (instrument_token, exchange_token, tradingsymbol, name, exchange, segment, instrument_type, lot_size, tick_size)
    # Indices
    (256265, 1000, "NIFTY 50", "Nifty 50 Index", "NSE", "INDICES", "EQ", 1, 0.05),
    (260105, 1016, "NIFTY BANK", "Nifty Bank Index", "NSE", "INDICES", "EQ", 1, 0.05),
    (261889, 1023, "NIFTY FIN SERVICE", "Nifty Financial Services", "NSE", "INDICES", "EQ", 1, 0.05),
    (257801, 1006, "NIFTY IT", "Nifty IT Index", "NSE", "INDICES", "EQ", 1, 0.05),
    (259849, 1015, "INDIA VIX", "India VIX", "NSE", "INDICES", "EQ", 1, 0.0025),
    (265, 1, "SENSEX", "BSE Sensex", "BSE", "INDICES", "EQ", 1, 0.01),
    # NIFTY 50 Stocks
    (2953217, 11536, "RELIANCE", "Reliance Industries", "NSE", "NSE", "EQ", 1, 0.05),
    (340481, 1330, "TCS", "Tata Consultancy Services", "NSE", "NSE", "EQ", 1, 0.05),
    (341249, 1333, "HDFCBANK", "HDFC Bank", "NSE", "NSE", "EQ", 1, 0.05),
    (2760193, 10782, "INFY", "Infosys", "NSE", "NSE", "EQ", 1, 0.05),
    (408065, 1594, "ICICIBANK", "ICICI Bank", "NSE", "NSE", "EQ", 1, 0.05),
    (2865921, 11195, "HINDUNILVR", "Hindustan Unilever", "NSE", "NSE", "EQ", 1, 0.05),
    (60417, 236, "SBIN", "State Bank of India", "NSE", "NSE", "EQ", 1, 0.05),
    (1270529, 4963, "BHARTIARTL", "Bharti Airtel", "NSE", "NSE", "EQ", 1, 0.05),
    (2714625, 10604, "ITC", "ITC Limited", "NSE", "NSE", "EQ", 1, 0.05),
    (2393089, 9348, "KOTAKBANK", "Kotak Mahindra Bank", "NSE", "NSE", "EQ", 1, 0.05),
    (969473, 3787, "LT", "Larsen and Toubro", "NSE", "NSE", "EQ", 1, 0.05),
    (3861249, 15083, "AXISBANK", "Axis Bank", "NSE", "NSE", "EQ", 1, 0.05),
    (1510401, 5900, "ASIANPAINT", "Asian Paints", "NSE", "NSE", "EQ", 1, 0.05),
    (779521, 3045, "MARUTI", "Maruti Suzuki", "NSE", "NSE", "EQ", 1, 0.05),
    (2815745, 10999, "BAJFINANCE", "Bajaj Finance", "NSE", "NSE", "EQ", 1, 0.05),
    (2524929, 9863, "TITAN", "Titan Company", "NSE", "NSE", "EQ", 1, 0.05),
    (225537, 881, "SUNPHARMA", "Sun Pharmaceutical", "NSE", "NSE", "EQ", 1, 0.05),
    (112129, 438, "WIPRO", "Wipro", "NSE", "NSE", "EQ", 1, 0.05),
    (4267265, 16669, "ULTRACEMCO", "UltraTech Cement", "NSE", "NSE", "EQ", 1, 0.05),
    (2977281, 11629, "TATAMOTORS", "Tata Motors", "NSE", "NSE", "EQ", 1, 0.05),
    (3001089, 11723, "NESTLEIND", "Nestle India", "NSE", "NSE", "EQ", 1, 0.05),
    (3426049, 13383, "NTPC", "NTPC Limited", "NSE", "NSE", "EQ", 1, 0.05),
    (738561, 2885, "POWERGRID", "Power Grid Corp", "NSE", "NSE", "EQ", 1, 0.05),
    (2939649, 11483, "ONGC", "Oil and Natural Gas Corp", "NSE", "NSE", "EQ", 1, 0.05),
    (2029825, 7929, "M&M", "Mahindra and Mahindra", "NSE", "NSE", "EQ", 1, 0.05),
    (3834113, 14977, "HCLTECH", "HCL Technologies", "NSE", "NSE", "EQ", 1, 0.05),
    (3465729, 13538, "TECHM", "Tech Mahindra", "NSE", "NSE", "EQ", 1, 0.05),
    (134657, 526, "INDUSINDBK", "IndusInd Bank", "NSE", "NSE", "EQ", 1, 0.05),
    (548865, 2144, "BAJAJFINSV", "Bajaj Finserv", "NSE", "NSE", "EQ", 1, 0.05),
    (2913281, 11380, "TATASTEEL", "Tata Steel", "NSE", "NSE", "EQ", 1, 0.05),
    (81153, 317, "DRREDDY", "Dr Reddys Laboratories", "NSE", "NSE", "EQ", 1, 0.05),
    (897537, 3506, "CIPLA", "Cipla", "NSE", "NSE", "EQ", 1, 0.05),
    (2889473, 11287, "COALINDIA", "Coal India", "NSE", "NSE", "EQ", 1, 0.05),
    (582913, 2277, "GRASIM", "Grasim Industries", "NSE", "NSE", "EQ", 1, 0.05),
    (492033, 1922, "DIVISLAB", "Divis Laboratories", "NSE", "NSE", "EQ", 1, 0.05),
    (4451329, 17388, "ADANIENT", "Adani Enterprises", "NSE", "NSE", "EQ", 1, 0.05),
    (6401, 25, "ADANIPORTS", "Adani Ports", "NSE", "NSE", "EQ", 1, 0.05),
    (315393, 1232, "JSWSTEEL", "JSW Steel", "NSE", "NSE", "EQ", 1, 0.05),
    (519937, 2031, "BPCL", "Bharat Petroleum", "NSE", "NSE", "EQ", 1, 0.05),
    (3812865, 14894, "EICHERMOT", "Eicher Motors", "NSE", "NSE", "EQ", 1, 0.05),
    (49409, 193, "HEROMOTOCO", "Hero MotoCorp", "NSE", "NSE", "EQ", 1, 0.05),
    (2752769, 10753, "BRITANNIA", "Britannia Industries", "NSE", "NSE", "EQ", 1, 0.05),
    (424961, 1660, "APOLLOHOSP", "Apollo Hospitals", "NSE", "NSE", "EQ", 1, 0.05),
    (232961, 910, "TATACONSUM", "Tata Consumer Products", "NSE", "NSE", "EQ", 1, 0.05),
    (617473, 2412, "HINDALCO", "Hindalco Industries", "NSE", "NSE", "EQ", 1, 0.05),
    (5215745, 20374, "BAJAJ-AUTO", "Bajaj Auto", "NSE", "NSE", "EQ", 1, 0.05),
    (2031617, 7936, "SBILIFE", "SBI Life Insurance", "NSE", "NSE", "EQ", 1, 0.05),
    (7712001, 30125, "HDFCLIFE", "HDFC Life Insurance", "NSE", "NSE", "EQ", 1, 0.05),
    (2748929, 10738, "BANKBARODA", "Bank of Baroda", "NSE", "NSE", "EQ", 1, 0.05),
    (633601, 2475, "IOC", "Indian Oil Corporation", "NSE", "NSE", "EQ", 1, 0.05),
    (4598529, 17963, "VEDL", "Vedanta Limited", "NSE", "NSE", "EQ", 1, 0.05),
    (784129, 3063, "PNB", "Punjab National Bank", "NSE", "NSE", "EQ", 1, 0.05),
    (345089, 1348, "TRENT", "Trent Limited", "NSE", "NSE", "EQ", 1, 0.05),
    (160001, 625, "ZOMATO", "Zomato Limited", "NSE", "NSE", "EQ", 1, 0.05),
    (5103873, 19937, "HAL", "Hindustan Aeronautics", "NSE", "NSE", "EQ", 1, 0.05),
    (3699201, 14450, "DLF", "DLF Limited", "NSE", "NSE", "EQ", 1, 0.05),
]


async def seed():
    engine = create_async_engine(
        "postgresql+asyncpg://algotrader:algotrader_dev_2024@localhost:5432/algo_trading"
    )
    now = datetime.now(timezone.utc)

    async with engine.begin() as conn:
        for inst in INSTRUMENTS:
            await conn.execute(
                text(
                    "INSERT INTO instruments (instrument_token, exchange_token, tradingsymbol, name, exchange, segment, instrument_type, lot_size, tick_size, last_updated) "
                    "VALUES (:token, :et, :ts, :name, :exch, :seg, :itype, :lot, :tick, :updated) "
                    "ON CONFLICT (instrument_token) DO UPDATE SET tradingsymbol = EXCLUDED.tradingsymbol, name = EXCLUDED.name, last_updated = EXCLUDED.last_updated"
                ),
                {
                    "token": inst[0], "et": inst[1], "ts": inst[2], "name": inst[3],
                    "exch": inst[4], "seg": inst[5], "itype": inst[6], "lot": inst[7],
                    "tick": inst[8], "updated": now,
                },
            )

    await engine.dispose()
    print(f"Seeded {len(INSTRUMENTS)} instruments successfully")


if __name__ == "__main__":
    asyncio.run(seed())

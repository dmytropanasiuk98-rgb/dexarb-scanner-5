# DEXARB Pro - 7 Exchange Arbitrage Scanner 🚀

Сканнер арбітражних можливостей у реальному часі між **7 децентралізованими та перпетуальними біржами**:

1. **Ondo Perps**
2. **Robinhood Lighter**
3. **Variational Omni**
4. **Extended DEX**
5. **Lighter DEX**
6. **RiseX** (`https://rise.trade`)
7. **Bullet DEX** (`https://bullet.xyz`)

---

## ⚡ Швидкий запуск локально

1. Встановіть необхідні залежності Python:
```bash
pip install -r requirements.txt
```

2. Запустіть сервер:
```bash
python server.py
```

3. Відкрийте сканер у браузері:
```
http://127.0.0.1:8000
```

---

## ☁️ Деплой на хостинг (Render / Railway / VPS)

- **Start command**: `python server.py` або `uvicorn server:app --host 0.0.0.0 --port $PORT`
- **Python Version**: 3.10+
- **Всі необхідні файли знаходяться у цьому репозиторії.**

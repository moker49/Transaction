@echo off
py -c "from server import app, ensure_database; ensure_database(); app.run(host='0.0.0.0', port=5050, debug=False, use_reloader=False)"

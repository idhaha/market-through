from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

URL = (
    "https://www.barchart.com/proxies/timeseries/historical/queryeod.ashx"
    "?symbol=%24MOVE&data=daily&maxrecords=640&volume=contract"
    "&order=asc&dividends=false&backadjust=false"
    "&daystoexpiration=1&contractroll=combined"
    "&splits=true&padded=false"
)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/move":
            try:
                req = Request(URL, headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": "https://www.barchart.com/"
                })

                with urlopen(req, timeout=20) as response:
                    data = response.read()

                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)

            except (HTTPError, URLError, TimeoutError) as e:
                self.send_error(502, f"Barchart 요청 실패: {e}")
        else:
            super().do_GET()

print("로컬 서버 주소: http://localhost:8000")
HTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
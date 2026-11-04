using System;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.WinForms;
class ViNativeSmoke {
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    [STAThread] static int Main(string[] args) {
        try {
            var assembly = Assembly.LoadFrom("MarketThroughIndependent.exe");
            var validate = assembly.GetType("Program").GetMethod("Validate", BindingFlags.Static | BindingFlags.NonPublic);
            var origin = File.ReadAllLines("server-origin.txt")[0].Trim();
            var url = origin + "/vi-monitor.html#token=" + new string('a', 64);
            Check((string)validate.Invoke(null, new object[] { "marketthrough://open?url=" + Uri.EscapeDataString(url) }) == url, "VI URL validation");
            foreach (var bad in new[] { url.Replace(new string('a', 64), "bad"), url.Replace("/vi-monitor.html", "/other.html"), url.Replace(origin, "https://untrusted.invalid") }) {
                try { validate.Invoke(null, new object[] { "marketthrough://open?url=" + Uri.EscapeDataString(bad) }); throw new Exception("Invalid VI URL accepted"); }
                catch (TargetInvocationException) { }
            }
            var state = Path.Combine(Environment.CurrentDirectory, "vi-test-state");
            using (var form = (Form)Activator.CreateInstance(assembly.GetType("IndependentForm"), BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { url, state }, null)) {
                Check(form.Text == "MarketThrough VI 모니터링", "VI window title");
                Check(form.MinimumSize.Width >= 300, "VI minimum bounds");
            }
            Console.WriteLine("PASS VI native URL, trusted origin, capability validation, window title and constructor");
            if (args.Length > 0) {
                Exception failure = null;
                using (var form = (Form)Activator.CreateInstance(assembly.GetType("IndependentForm"), BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { args[0], state }, null)) {
                    form.ShowInTaskbar = false; form.Opacity = 0;
                    var web = (WebView2)form.GetType().GetField("web", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
                    form.Shown += async delegate {
                        try {
                            bool loaded = false;
                            for (int i = 0; i < 150; i++) {
                                await Task.Delay(200);
                                if (web.CoreWebView2 == null) continue;
                                var result = await web.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('#viBody tr[data-code]').length === 3 && document.querySelectorAll('#viBody tr.released').length === 1 && document.querySelector('.comparison-group').textContent === 'KRX대비'");
                                if (result == "true") { loaded = true; break; }
                            }
                            Check(loaded, "Actual native VI WebView did not receive server state");
                            await web.CoreWebView2.ExecuteScriptAsync("document.getElementById('viTopmost').checked=true; document.getElementById('viTopmost').dispatchEvent(new Event('change'))");
                            for (int i = 0; i < 20 && !form.TopMost; i++) await Task.Delay(100);
                            Check(form.TopMost, "VI always-on-top native bridge");
                            Console.WriteLine("PASS actual native VI WebView2: scoped token, SSE rows, released state, grouped heading and always-on-top bridge");
                        } catch (Exception e) { failure = e; }
                        finally { form.TopMost = false; form.Close(); }
                    };
                    Application.Run(form);
                    if (failure != null) throw failure;
                }
            }
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
}

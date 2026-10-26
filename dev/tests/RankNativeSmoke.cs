using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class RankNativeSmoke {
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    [STAThread] static int Main(string[] args) {
        try {
            Application.EnableVisualStyles();
            string[] origins = File.ReadAllLines("server-origin.txt");
            string origin = origins[0].Trim();
            string target = origin + "/rank-independent.html#id=" + new string('a', 32) + "&token=" + new string('b', 64);
            string launch = "marketthrough://open?url=" + Uri.EscapeDataString(target);
            var assembly = Assembly.LoadFrom("MarketThroughIndependent.exe");
            var validate = assembly.GetType("Program").GetMethod("Validate", BindingFlags.Static | BindingFlags.NonPublic);
            Check((string)validate.Invoke(null, new object[] { launch }) == target, "Valid origin rejected");
            foreach (string address in origins) {
                string candidate = target.Replace(origin, address.Trim());
                Check((string)validate.Invoke(null, new object[] { "marketthrough://open?url=" + Uri.EscapeDataString(candidate) }) == candidate, "Allowed origin rejected: " + address);
            }
            try { validate.Invoke(null, new object[] { "marketthrough://open?url=" + Uri.EscapeDataString(target.Replace(origin, "http://localhost:9999")) }); throw new Exception("Unlisted localhost port accepted"); }
            catch (TargetInvocationException) { }
            try { validate.Invoke(null, new object[] { "marketthrough://open?url=" + Uri.EscapeDataString(target.Replace(origin, "https://untrusted.invalid")) }); throw new Exception("Untrusted origin accepted"); }
            catch (TargetInvocationException) { }
            try { validate.Invoke(null, new object[] { "marketthrough://open?url=" + Uri.EscapeDataString(target.Replace("/rank-independent.html", "/")) }); throw new Exception("Untrusted page accepted"); }
            catch (TargetInvocationException) { }
            string state = Path.Combine(Environment.CurrentDirectory, "native-test-state", "bounds.json");
            Directory.CreateDirectory(Path.GetDirectoryName(state)); string previous = File.Exists(state) ? File.ReadAllText(state) : null;
            try {
                File.WriteAllText(state, "[999999,999999,999999,999999]");
                using (var form = (Form)Activator.CreateInstance(assembly.GetType("IndependentForm"), BindingFlags.Instance | BindingFlags.NonPublic, null, new object[] { target, Path.GetDirectoryName(state) }, null)) {
                    Check(form.Text == "MarketThrough 독립창", "Window title");
                    Check(Screen.FromRectangle(form.Bounds).WorkingArea.Contains(form.Bounds), "Offscreen bounds recovery");
                    var recover = form.GetType().GetMethod("EnsureVisibleBounds", BindingFlags.Instance | BindingFlags.NonPublic);
                    Check(recover != null, "Running window recovery handler");
                    form.Bounds = new Rectangle(999999, 999999, 900, 600);
                    recover.Invoke(form, null);
                    Check(Screen.FromRectangle(form.Bounds).WorkingArea.Contains(form.Bounds), "Running offscreen window recovery");
                    var area = Screen.FromRectangle(form.Bounds).WorkingArea;
                    form.Bounds = new Rectangle(area.Left + 20, area.Top - 200, 900, 600);
                    recover.Invoke(form, null);
                    Check(form.Top >= area.Top && area.Contains(form.Bounds), "Recover inaccessible title bar even when most of the window remains visible");
                    form.WindowState = FormWindowState.Minimized;
                    recover.Invoke(form, null);
                    Check(form.WindowState == FormWindowState.Minimized, "Periodic bounds recovery must preserve intentional minimization");
                    form.WindowState = FormWindowState.Normal;
                    var remember = form.GetType().GetMethod("RememberBounds", BindingFlags.Instance | BindingFlags.NonPublic);
                    var chosen = new Rectangle(area.Right - 400, area.Top + 20, 380, 300);
                    form.Bounds = chosen; remember.Invoke(form, null);
                    form.Left = area.Left;
                    recover.Invoke(form, null);
                    Check(form.Bounds == chosen, "Restore chosen right-side placement after system relocation");
                    var changedAt = form.GetType().GetField("layoutChangedAt", BindingFlags.Instance | BindingFlags.NonPublic);
                    changedAt.SetValue(form, DateTime.UtcNow);
                    form.Left = area.Left;
                    var temporary = form.Bounds;
                    recover.Invoke(form, null);
                    Check(form.Bounds == temporary, "Wait for display layout to settle before moving window");
                    changedAt.SetValue(form, DateTime.UtcNow.AddSeconds(-5));
                    recover.Invoke(form, null);
                    Check(form.Bounds == chosen, "Restore placement after display settles");
                    form.Left = area.Left + 40; remember.Invoke(form, null);
                    var movedByUser = form.Bounds;
                    recover.Invoke(form, null);
                    Check(form.Bounds == movedByUser, "Keep newly chosen user placement");
                    var preferred = form.GetType().GetField("preferredBounds", BindingFlags.Instance | BindingFlags.NonPublic);
                    var unavailable = new Rectangle(999999, 20, 380, 300);
                    preferred.SetValue(form, unavailable);
                    form.Bounds = unavailable;
                    recover.Invoke(form, null);
                    Check(Screen.FromRectangle(form.Bounds).WorkingArea.Contains(form.Bounds), "Recover placement when original monitor is unavailable");
                    Check((Rectangle)preferred.GetValue(form) == unavailable, "Temporary recovery must not overwrite preferred placement");
                    preferred.SetValue(form, movedByUser);
                    recover.Invoke(form, null);
                    Check(form.Bounds == movedByUser, "Restore when preferred screen becomes available again");
                    Check(form.Controls.Count == 1 && form.Controls[0] is WebView2, "Web page fills the native client area");
                    form.TopMost = true; Check(form.TopMost, "TopMost enabled"); form.TopMost = false; Check(!form.TopMost, "TopMost disabled");
                    Check(form.FormBorderStyle == FormBorderStyle.Sizable && form.ControlBox && form.MinimizeBox && form.MaximizeBox, "Standard Windows frame");
                }
            } finally { if (previous != null) File.WriteAllText(state, previous); else File.Delete(state); }
            Console.WriteLine("PASS native protocol origin/page validation, standard window frame, TopMost property and offscreen bounds recovery");
            // Initialize the actual installed runtime in a hidden control/message loop.
            var context = new ApplicationContext(); var host = new Form { Width = 1300, Height = 900, Opacity = 0, ShowInTaskbar = false }; var web = new WebView2 { Dock = DockStyle.Fill }; host.Controls.Add(web);
            var handle = host.Handle; var webHandle = web.Handle;
            host.Show();
            Exception failure = null;
            bool started = false;
            var timer = new Timer { Interval = 100 }; timer.Tick += async delegate {
                if (started) return; started = true;
                timer.Stop();
                try {
                    var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Path.GetTempPath(), "MarketThroughNativeSmoke"));
                    await web.EnsureCoreWebView2Async(env);
                    Console.WriteLine("PASS actual WebView2 runtime initialization: " + env.BrowserVersionString);
                    if (args.Length > 0) {
                        var core = web.CoreWebView2;
                        core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e) { Console.Error.WriteLine("WebView process failure: " + e.ProcessFailedKind); };
                        core.Navigate(args[0]);
                        bool loaded = false;
                        for (int attempt = 0; attempt < 100; attempt++) {
                            await Task.Delay(200);
                            var result = await core.ExecuteScriptAsync("!!(window.getRankChartState && getRankChartState().points.length === 40 && document.querySelectorAll('#transactionBody tr').length === 2)");
                            if (result == "true") { loaded = true; break; }
                        }
                        Check(loaded, "Real native WebView2 did not receive the shared Rank snapshot");
                        await core.ExecuteScriptAsync("window.__rowBefore = document.querySelector('#transactionBody tr').getBoundingClientRect().height; window.__fontBefore = getComputedStyle(document.querySelector('#transactionBody td')).fontSize;");
                        host.Height -= 180;
                        bool resized = false;
                        for (int attempt = 0; attempt < 20; attempt++) {
                            await Task.Delay(100);
                            var result = await core.ExecuteScriptAsync("document.querySelector('#transactionBody tr').getBoundingClientRect().height <= window.__rowBefore && getComputedStyle(document.querySelector('#transactionBody td')).fontSize === window.__fontBefore && document.querySelectorAll('#tab_rank > .panel').length === 3 && document.getElementById('rankSupplyChartPanel').offsetTop > document.getElementById('concentrationChartPanel').offsetTop");
                            if (result == "true") { resized = true; break; }
                        }
                        Check(resized, "Real WebView2 must keep three vertical cards and fixed table typography at its minimum card height");
                        Console.WriteLine("PASS real native WebView2 page and capability relay shared snapshot");
                    }
                } catch (Exception error) { Console.Error.WriteLine(error); failure = error; }
                finally { web.Dispose(); host.Dispose(); context.ExitThread(); }
            };
            timer.Start(); Application.Run(context); timer.Dispose();
            if (failure != null) throw failure;
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}

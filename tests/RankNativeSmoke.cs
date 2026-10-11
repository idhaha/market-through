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
                    Check(form.Text == "[독립창]", "Window title");
                    Check(Screen.FromRectangle(form.Bounds).WorkingArea.Contains(form.Bounds), "Offscreen bounds recovery");
                    Panel bar = null; foreach (Control control in form.Controls) if (control is Panel) bar = (Panel)control;
                    Check(bar != null, "Titlebar");
                    CheckBox top = null; Label topText = null; Button minimize = null;
                    foreach (Control control in bar.Controls) {
                        if (control is Panel) foreach (Control child in control.Controls) { if (child is CheckBox) top = (CheckBox)child; if (child is Label) topText = (Label)child; }
                        if (control is Button && control.Text == "−") minimize = (Button)control;
                    }
                    Check(top != null && minimize != null, "Native title controls");
                    Check(bar.BackColor == Color.FromArgb(226, 232, 240), "Fixed tab titlebar color");
                    Check(topText != null && topText.Text == "항상 위" && top.AccessibleName == "항상 위", "Always-on-top wording");
                    Check(top.Bounds.Top == minimize.Bounds.Top && top.Height == minimize.Height, "Title controls vertical alignment");
                    Check(topText.Width >= TextRenderer.MeasureText(topText.Text, topText.Font).Width, "Always-on-top text clipped");
                    top.Checked = true; Check(form.TopMost, "TopMost enabled"); top.Checked = false; Check(!form.TopMost, "TopMost disabled");
                    Check(form.FormBorderStyle == FormBorderStyle.None, "Custom native frame");
                }
            } finally { if (previous != null) File.WriteAllText(state, previous); else File.Delete(state); }
            Console.WriteLine("PASS native protocol origin/page validation, title controls, TopMost property and offscreen bounds recovery");
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

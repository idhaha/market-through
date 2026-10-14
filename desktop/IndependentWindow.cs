using System;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program {
    internal const string Identity = "MarketThrough.Rank.Independent.v1";
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        string url;
        try { url = Validate(args.Length > 0 ? args[0] : ""); }
        catch (Exception error) { MessageBox.Show(error.Message, "독립창"); return; }
        bool created;
        using (var mutex = new Mutex(true, "Local\\" + Identity, out created)) {
            if (!created) {
                try { using (var pipe = new NamedPipeClientStream(".", Identity, PipeDirection.Out)) {
                    pipe.Connect(3000); using (var writer = new StreamWriter(pipe)) { writer.WriteLine(url); writer.Flush(); }
                }} catch { MessageBox.Show("이미 실행된 독립창을 닫고 다시 실행하세요.", "독립창"); }
                return;
            }
            Application.Run(new IndependentForm(url));
        }
    }
    internal static string Validate(string launch) {
        var protocol = new Uri(launch);
        if (protocol.Scheme != "marketthrough" || protocol.Host != "open") throw new Exception("웹페이지의 독립창 버튼으로 실행하세요.");
        string query = protocol.Query.TrimStart('?');
        if (!query.StartsWith("url=", StringComparison.Ordinal) || query.IndexOf('&') >= 0) throw new Exception("잘못된 독립창 주소입니다.");
        string url = Uri.UnescapeDataString(query.Substring(4)); var target = new Uri(url);
        string[] allowed = File.ReadAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "server-origin.txt"));
        bool trusted = Array.Exists(allowed, address => address.Trim().TrimEnd('/') == target.GetLeftPart(UriPartial.Authority));
        if (!trusted || target.AbsolutePath != "/rank-independent.html" || target.Query.Length != 0 || target.UserInfo.Length != 0
            || !System.Text.RegularExpressions.Regex.IsMatch(target.Fragment, "^#id=[a-f0-9]{32}&token=[a-f0-9]{64}$")) throw new Exception("허용되지 않은 독립창 서버 주소입니다.");
        return url;
    }
}
internal sealed class IndependentForm : Form {
    readonly WebView2 web = new WebView2();
    readonly string folder;
    readonly string initial;
    string current;
    string allowed;
    bool ready, exiting;
    NamedPipeServerStream serverPipe;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    internal IndependentForm(string url) : this(url, null) { }
    internal IndependentForm(string url, string stateDirectory) {
        folder = stateDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarketThrough", "State");
        initial = url; current = url; allowed = new Uri(url).GetLeftPart(UriPartial.Authority);
        Text = "MarketThrough 독립창"; Font = new Font("맑은 고딕", 9F); FormBorderStyle = FormBorderStyle.Sizable; BackColor = Color.FromArgb(210, 218, 230);
        MinimumSize = new Size(320, 160); Size = new Size(1250, 800); StartPosition = FormStartPosition.Manual;
        Directory.CreateDirectory(folder); RestoreBoundsFromDisk();
        var bar = new Panel { Dock = DockStyle.Top, Height = 30, BackColor = Color.FromArgb(226, 232, 240) };
        var top = new CheckBox { Text = "항상 위", AccessibleName = "항상 위", Dock = DockStyle.Right, Width = 90, AutoSize = false, TextAlign = ContentAlignment.MiddleLeft, BackColor = bar.BackColor };
        top.CheckedChanged += delegate { TopMost = top.Checked; };
        bar.Controls.Add(top);
        web.Dock = DockStyle.Fill; Controls.Add(web); Controls.Add(bar);
        Activated += delegate { EnsureVisibleBounds(); };
        Shown += async delegate {
            try {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(folder, "WebView2"));
                await web.EnsureCoreWebView2Async(env);
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
                web.CoreWebView2.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs e) {
                    if (!exiting && (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited || e.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited)) {
                        exiting = true;
                        BeginInvoke(new Action(delegate { MessageBox.Show("WebView2 연결이 종료되었습니다. 웹페이지에서 독립창을 다시 실행하세요.", "독립창"); Close(); }));
                    }
                };
                web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                    Uri next; if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out next) || next.GetLeftPart(UriPartial.Authority) != allowed || next.AbsolutePath != "/rank-independent.html") e.Cancel = true;
                };
                web.CoreWebView2.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
                    Uri source;
                    if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.GetLeftPart(UriPartial.Authority) != allowed || source.AbsolutePath != "/rank-independent.html") return;
                    string message;
                    try { message = e.TryGetWebMessageAsString(); } catch { return; }
                    if (message == "connection-ended") Close();
                    else if (message.StartsWith("page-scale:")) {
                        double ratio;
                        if (double.TryParse(message.Substring(11), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out ratio) && ratio >= 0.25 && ratio <= 4) web.ZoomFactor = Math.Max(0.25, Math.Min(4, web.ZoomFactor * ratio));
                    }
                    else if (message.StartsWith("resize-window:")) {
                        var values = message.Substring(14).Split(','); int dw, dh, vw, vh;
                        if (values.Length != 4 || !int.TryParse(values[0], out dw) || !int.TryParse(values[1], out dh) || !int.TryParse(values[2], out vw) || !int.TryParse(values[3], out vh) || vw < 1 || vh < 1 || Math.Abs((long)dw) > 10000 || Math.Abs((long)dh) > 10000) return;
                        WindowState = FormWindowState.Normal;
                        var area = Screen.FromRectangle(Bounds).WorkingArea;
                        Width = Math.Max(MinimumSize.Width, Math.Min(area.Width, Width + (int)Math.Round(dw * (double)web.ClientSize.Width / vw)));
                        Height = Math.Max(MinimumSize.Height, Math.Min(area.Height, Height + (int)Math.Round(dh * (double)web.ClientSize.Height / vh)));
                        Left = Math.Max(area.Left, Math.Min(Left, area.Right - Width)); Top = Math.Max(area.Top, Math.Min(Top, area.Bottom - Height));
                    }
                };
                ready = true; web.CoreWebView2.Navigate(initial);
                var thread = new Thread(Listen); thread.IsBackground = true; thread.Start();
            } catch (Exception error) { MessageBox.Show("WebView2를 초기화할 수 없습니다. 독립창 앱을 다시 설치하세요.\n" + error.Message, "독립창"); Close(); }
        };
        FormClosing += delegate {
            NotifyClose();
            exiting = true; if (serverPipe != null) serverPipe.Dispose();
            try {
                var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                File.WriteAllText(Path.Combine(folder, "bounds.json"), json.Serialize(new int[] { bounds.X, bounds.Y, bounds.Width, bounds.Height }));
                if (ready) web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('pagehide'))");
            } catch { }
        };
    }
    void Listen() {
        while (!exiting) {
            try {
                using (serverPipe = new NamedPipeServerStream(Program.Identity, PipeDirection.In, 1)) {
                    serverPipe.WaitForConnection(); string url;
                    using (var reader = new StreamReader(serverPipe)) { url = reader.ReadLine(); }
                    if (url != null && !exiting) BeginInvoke(new Action(delegate {
                        try { Program.Validate("marketthrough://open?url=" + Uri.EscapeDataString(url));
                            NotifyClose(); current = url; allowed = new Uri(url).GetLeftPart(UriPartial.Authority);
                            WindowState = FormWindowState.Normal; EnsureVisibleBounds(); Show(); BringToFront(); Activate();
                            web.CoreWebView2.Navigate(url);
                        } catch { }
                    }));
                }
            } catch { if (exiting) return; }
        }
    }
    void NotifyClose() {
        try {
            var target = new Uri(current); var values = target.Fragment.TrimStart('#').Split('&');
            string id = values[0].Substring(3), token = values[1].Substring(6);
            var request = (HttpWebRequest)WebRequest.Create(allowed + "/api/rank-independent/peer/" + id);
            request.Method = "POST"; request.ContentType = "application/json"; request.Headers["Authorization"] = "Bearer " + token; request.Timeout = 1500;
            var bytes = System.Text.Encoding.UTF8.GetBytes("{\"close\":true}"); request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
            using (var response = request.GetResponse()) { }
        } catch { }
    }
    void RestoreBoundsFromDisk() {
        var area = Screen.PrimaryScreen.WorkingArea;
        Bounds = new Rectangle(area.Left + 30, area.Top + 30, Math.Min(1250, area.Width), Math.Min(800, area.Height));
        try {
            var values = json.Deserialize<int[]>(File.ReadAllText(Path.Combine(folder, "bounds.json")));
            var saved = new Rectangle(values[0], values[1], Math.Max(320, values[2]), Math.Max(160, values[3]));
            var screen = Screen.FromRectangle(saved).WorkingArea;
            saved.Width = Math.Min(saved.Width, screen.Width); saved.Height = Math.Min(saved.Height, screen.Height);
            saved.X = Math.Max(screen.Left, Math.Min(saved.X, screen.Right - saved.Width)); saved.Y = Math.Max(screen.Top, Math.Min(saved.Y, screen.Bottom - saved.Height)); Bounds = saved;
        } catch { }
    }
    void EnsureVisibleBounds() {
        if (WindowState != FormWindowState.Normal) return;
        var bounds = Bounds;
        var area = Screen.FromRectangle(bounds).WorkingArea;
        var visible = Rectangle.Intersect(bounds, area);
        if (visible.Width >= Math.Min(160, bounds.Width) && visible.Height >= Math.Min(80, bounds.Height)) return;
        bounds.Width = Math.Min(bounds.Width, area.Width);
        bounds.Height = Math.Min(bounds.Height, area.Height);
        bounds.X = Math.Max(area.Left, Math.Min(bounds.X, area.Right - bounds.Width));
        bounds.Y = Math.Max(area.Top, Math.Min(bounds.Y, area.Bottom - bounds.Height));
        Bounds = bounds;
    }
}

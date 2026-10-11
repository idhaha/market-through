using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Installer {
    [STAThread] static void Main() {
        Application.EnableVisualStyles();
        var form = new Form { Text = "독립창 앱 설치", Width = 480, Height = 180, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false };
        var label = new Label { Dock = DockStyle.Fill, Text = "독립창 앱을 설치하고 있습니다…", Padding = new Padding(24), AutoSize = false };
        form.Controls.Add(label);
        form.Shown += async delegate {
            try {
                string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarketThrough", "Independent");
                if (Process.GetProcessesByName("MarketThroughIndependent").Length > 0) throw new Exception("실행 중인 독립창을 닫은 뒤 설치를 다시 실행하세요.");
                Directory.CreateDirectory(folder);
                using (var resource = typeof(Installer).Assembly.GetManifestResourceStream("payload.zip"))
                using (var zip = new ZipArchive(resource, ZipArchiveMode.Read)) {
                    foreach (var entry in zip.Entries) {
                        if (Path.GetFileName(entry.FullName) != entry.FullName) throw new Exception("잘못된 설치 파일입니다.");
                        using (var source = entry.Open()) using (var target = File.Create(Path.Combine(folder, entry.FullName))) source.CopyTo(target);
                    }
                }
                var core = System.Reflection.Assembly.LoadFrom(Path.Combine(folder, "Microsoft.Web.WebView2.Core.dll"));
                bool runtime = false;
                try { var type = core.GetType("Microsoft.Web.WebView2.Core.CoreWebView2Environment");
                    var version = type.GetMethod("GetAvailableBrowserVersionString", new Type[] { typeof(string) }).Invoke(null, new object[] { null }); runtime = version != null;
                } catch { }
                if (!runtime) {
                    label.Text = "Microsoft WebView2를 내려받아 설치하고 있습니다…";
                    string bootstrap = Path.Combine(folder, "MicrosoftEdgeWebview2Setup.exe");
                    ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                    using (var client = new WebClient()) await client.DownloadFileTaskAsync(new Uri("https://go.microsoft.com/fwlink/p/?LinkId=2124703"), bootstrap);
                    // Verify Microsoft's Authenticode signature before executing a downloaded installer.
                    string script = "$s=Get-AuthenticodeSignature -LiteralPath '" + bootstrap.Replace("'", "''") + "'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){exit 1}";
                    string encoded = Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(script));
                    var verify = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -EncodedCommand " + encoded) { UseShellExecute = false, CreateNoWindow = true });
                    await System.Threading.Tasks.Task.Run(() => verify.WaitForExit());
                    if (verify.ExitCode != 0) throw new Exception("WebView2 설치 파일의 Microsoft 서명을 확인할 수 없습니다.");
                    var install = Process.Start(new ProcessStartInfo(bootstrap, "/silent /install") { UseShellExecute = false, CreateNoWindow = true });
                    await System.Threading.Tasks.Task.Run(() => install.WaitForExit());
                    if (install.ExitCode != 0) throw new Exception("WebView2 설치 실패: " + install.ExitCode);
                    File.Delete(bootstrap);
                }
                string exe = Path.Combine(folder, "MarketThroughIndependent.exe");
                using (var key = Registry.CurrentUser.CreateSubKey("Software\\Classes\\marketthrough")) {
                    key.SetValue("", "URL:MarketThrough 독립창"); key.SetValue("URL Protocol", "");
                    using (var command = key.CreateSubKey("shell\\open\\command")) command.SetValue("", "\"" + exe + "\" \"%1\"");
                }
                using (var key = Registry.CurrentUser.CreateSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MarketThroughIndependent")) {
                    key.SetValue("DisplayName", "MarketThrough 독립창");
                    key.SetValue("DisplayVersion", "1.0.0");
                    key.SetValue("Publisher", "MarketThrough");
                    key.SetValue("InstallLocation", folder);
                    key.SetValue("DisplayIcon", exe);
                    key.SetValue("UninstallString", "\"" + Path.Combine(folder, "Uninstall.exe") + "\"");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
                label.Text = "설치되었습니다. 웹페이지의 독립창 버튼을 다시 누르세요.";
                var done = new Button { Text = "닫기", Dock = DockStyle.Bottom, Height = 36 }; done.Click += delegate { form.Close(); }; form.Controls.Add(done);
            } catch (Exception error) { label.Text = "설치하지 못했습니다.\n" + error.Message; }
        };
        Application.Run(form);
    }
}

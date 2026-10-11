using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Uninstaller {
    internal const string ProtocolKey = "Software\\Classes\\marketthrough";
    internal const string AppKey = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MarketThroughIndependent";
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles();
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MarketThrough");
        try {
            if (Process.GetProcessesByName("MarketThroughIndependent").Length > 0) throw new Exception("독립창을 닫은 뒤 제거를 다시 실행하세요.");
            if (args.Length != 2 || args[0] != "--remove") {
                if (MessageBox.Show("독립창 앱과 저장된 창 위치·데이터를 모두 제거할까요?", "독립창 앱 제거", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
                // Run from TEMP so our installed executable can also be removed.
                string helper = Path.Combine(Path.GetTempPath(), "MarketThroughUninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(typeof(Uninstaller).Assembly.Location, helper);
                Process.Start(new ProcessStartInfo(helper, "--remove " + Process.GetCurrentProcess().Id) { UseShellExecute = false, CreateNoWindow = true });
                return;
            }
            int parentId;
            if (!int.TryParse(args[1], out parentId)) throw new Exception("잘못된 제거 요청입니다.");
            try { using (var parent = Process.GetProcessById(parentId)) { if (!parent.WaitForExit(10000)) throw new Exception("제거 프로그램을 다시 실행하세요."); } }
            catch (ArgumentException) { }
            // A closed WebView2 may briefly retain its cache handles.
            for (int attempt = 0; ; attempt++) {
                try { RemoveInstallation(root, Registry.CurrentUser); break; }
                catch (IOException) { if (attempt >= 9) throw; Thread.Sleep(500); }
            }
            MessageBox.Show("독립창 앱을 제거했습니다.", "독립창 앱 제거");
        } catch (Exception error) { MessageBox.Show("제거하지 못했습니다.\n" + error.Message, "독립창 앱 제거", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
    internal static void RemoveInstallation(string root, RegistryKey hive) {
        root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (!Path.IsPathRooted(root)) throw new IOException("제거 경로가 올바르지 않습니다.");
        if (Directory.Exists(root) && (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new IOException("앱 폴더가 다른 위치로 연결되어 있어 자동 제거할 수 없습니다.");
        string installed = Path.Combine(root, "Independent");
        RemoveTree(installed, root);
        RemoveTree(Path.Combine(root, "State"), root);
        using (var key = hive.OpenSubKey(ProtocolKey + "\\shell\\open\\command")) {
            string command = key == null ? null : key.GetValue("") as string;
            if (command != null && command.StartsWith("\"" + Path.Combine(installed, "MarketThroughIndependent.exe") + "\" ", StringComparison.OrdinalIgnoreCase)) hive.DeleteSubKeyTree(ProtocolKey, false);
        }
        using (var key = hive.OpenSubKey(AppKey)) {
            if (key != null && string.Equals(key.GetValue("InstallLocation") as string, installed, StringComparison.OrdinalIgnoreCase)) hive.DeleteSubKeyTree(AppKey, false);
        }
        if (Directory.Exists(root) && Directory.GetFileSystemEntries(root).Length == 0) Directory.Delete(root);
    }
    static void RemoveTree(string target, string root) {
        string full = Path.GetFullPath(target);
        if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("앱 폴더 밖의 파일은 제거할 수 없습니다.");
        if (!Directory.Exists(full)) return;
        if ((File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) { Directory.Delete(full, false); return; }
        foreach (string child in Directory.GetDirectories(full)) RemoveTree(child, root);
        foreach (string file in Directory.GetFiles(full)) { File.SetAttributes(file, FileAttributes.Normal); File.Delete(file); }
        Directory.Delete(full, false);
    }
}

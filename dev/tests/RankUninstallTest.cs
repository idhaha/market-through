using System;
using System.IO;
using Microsoft.Win32;

class RankUninstallTest {
    static void Check(bool condition, string reason) { if (!condition) throw new Exception(reason); }
    static int Main() {
        string scratch = "Software\\MarketThroughUninstallTests\\" + Guid.NewGuid().ToString("N");
        string root = Path.Combine(Environment.CurrentDirectory, "uninstall-test-" + Guid.NewGuid().ToString("N"));
        try {
            string installed = Path.Combine(root, "Independent"), state = Path.Combine(root, "State", "WebView2", "cache");
            Directory.CreateDirectory(installed); Directory.CreateDirectory(state);
            File.WriteAllText(Path.Combine(installed, "Uninstall.exe"), "test"); File.WriteAllText(Path.Combine(state, "cache.bin"), "test");
            using (var hive = Registry.CurrentUser.CreateSubKey(scratch)) {
                using (var key = hive.CreateSubKey(Uninstaller.ProtocolKey + "\\shell\\open\\command")) key.SetValue("", "\"" + Path.Combine(installed, "MarketThroughIndependent.exe") + "\" \"%1\"");
                using (var key = hive.CreateSubKey(Uninstaller.AppKey)) key.SetValue("InstallLocation", installed);
                Uninstaller.RemoveInstallation(root, hive);
                Check(!Directory.Exists(root), "App and state tree remained");
                Check(hive.OpenSubKey(Uninstaller.ProtocolKey) == null, "Protocol registration remained");
                Check(hive.OpenSubKey(Uninstaller.AppKey) == null, "Installed apps registration remained");
                Uninstaller.RemoveInstallation(root, hive); // Already removed installations are safe.
                Directory.CreateDirectory(root); File.WriteAllText(Path.Combine(root, "other.txt"), "keep");
                using (var key = hive.CreateSubKey(Uninstaller.ProtocolKey + "\\shell\\open\\command")) key.SetValue("", "\"C:\\OtherApp.exe\" \"%1\"");
                Uninstaller.RemoveInstallation(root, hive);
                Check(File.Exists(Path.Combine(root, "other.txt")), "Unrelated file removed");
                Check(hive.OpenSubKey(Uninstaller.ProtocolKey) != null, "Foreign protocol registration removed");
            }
            Console.WriteLine("PASS uninstall removes app/state/protocol/app registration, is repeatable, and preserves unrelated data/registration");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        finally {
            Registry.CurrentUser.DeleteSubKeyTree(scratch, false);
            if (Directory.Exists(root)) { File.Delete(Path.Combine(root, "other.txt")); Directory.Delete(root); }
        }
    }
}

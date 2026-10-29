using System;
using System.Diagnostics;

// Stand-in R1Q2 executable: hands its raw command line to node running stub-engine.cjs and
// forwards the exit code. The __NODE__ / __SCRIPT__ placeholders are filled in by the fixture.
static class StubEngineWrapper
{
    static int Main()
    {
        string line = Environment.CommandLine;
        int at = 0;
        if (line.Length > 0 && line[0] == '"')
        {
            at = line.IndexOf('"', 1);
            at = at < 0 ? line.Length : at + 1;
        }
        else
        {
            at = line.IndexOf(' ');
            at = at < 0 ? line.Length : at;
        }
        string tail = line.Substring(at).TrimStart();
        var info = new ProcessStartInfo("__NODE__", "\"__SCRIPT__\" " + tail);
        info.UseShellExecute = false;
        using (Process node = Process.Start(info))
        {
            node.WaitForExit();
            return node.ExitCode;
        }
    }
}

// Claude Tasks — shows Claude Code's per-session task lists (written by the task-tracker plugin)
// in a sidebar view and a status bar item. The Claude chat panel itself is a closed webview and
// cannot be extended, so this lives beside it.

const fs = require("node:fs");
const vscode = require("vscode");
const model = require("./lib/model");

const STATUS_ICON = {
  completed: new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("testing.iconPassed")),
  in_progress: new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.yellow")),
  pending: new vscode.ThemeIcon("circle-large-outline"),
};

function config() {
  const c = vscode.workspace.getConfiguration("claudeTasks");
  return {
    stateDir: c.get("stateDir") || model.defaultStateDir(),
    currentWorkspaceOnly: c.get("currentWorkspaceOnly", true),
    maxAgeHours: c.get("maxAgeHours", 24),
  };
}

// The label of the active editor tab — Claude chat tabs are titled with the session's ai-title.
function activeTabLabel() {
  return vscode.window.tabGroups?.activeTabGroup?.activeTab?.label;
}

class TasksProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this.sessions = [];
    this.focused = undefined;
    this.lastTabLabel = undefined;
  }

  reload() {
    const c = config();
    const folders = c.currentWorkspaceOnly
      ? (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
      : [];
    this.sessions = model.loadSessions({
      stateDir: c.stateDir,
      workspaceFolders: folders,
      maxAgeMs: c.maxAgeHours > 0 ? c.maxAgeHours * 3600 * 1000 : undefined,
    });
    const label = activeTabLabel();
    // Only follow tab changes onto Claude session tabs; keep the last match otherwise.
    if (label && this.sessions.some((s) => s.title === label)) this.lastTabLabel = label;
    this.focused = model.pickFocused(this.sessions, this.lastTabLabel);
    this._onDidChange.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      if (this.sessions.length === 0) {
        const empty = new vscode.TreeItem("No Claude task lists yet");
        empty.description = "they appear when Claude plans multi-step work";
        return [empty];
      }
      // Focused session first, the rest newest-first.
      const ordered = [this.focused, ...this.sessions.filter((s) => s !== this.focused)];
      return ordered.map((s) => this.sessionItem(s));
    }
    if (element.kind === "session") {
      const items = element.session.tasks.map((t) => this.taskItem(t));
      for (const sub of element.session.subagents) {
        // Running subagents open expanded — that is usually where the work is happening.
        const item = new vscode.TreeItem(
          model.subagentLabel(sub),
          sub.summary.finished ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = `${sub.summary.done}/${sub.summary.total}`;
        item.iconPath = new vscode.ThemeIcon("hubot");
        item.kind = "subagent";
        item.tasks = sub.tasks;
        items.push(item);
      }
      return items;
    }
    if (element.kind === "subagent") return element.tasks.map((t) => this.taskItem(t));
    return [];
  }

  sessionItem(session) {
    const isFocused = session === this.focused;
    const item = new vscode.TreeItem(
      model.sessionLabel(session),
      isFocused ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    // A new id per focus change lets VS Code apply the new expanded/collapsed default.
    item.id = `${session.sessionId}:${isFocused ? "f" : "c"}`;
    // A session with no list of its own but a running subagent shows the subagent's progress.
    const { done, total, finished } = model.primaryList(session)?.summary ?? session.summary;
    item.description = `${done}/${total}${finished ? " done" : ""} · ${model.relativeTime(session.updatedAt)}`;
    item.iconPath = new vscode.ThemeIcon(finished ? "pass" : isFocused ? "comment-discussion" : "history");
    item.tooltip = new vscode.MarkdownString(model.tooltipMarkdown(session));
    item.kind = "session";
    item.session = session;
    return item;
  }

  taskItem(task) {
    const text = task.status === "in_progress" && task.activeForm ? task.activeForm : task.content;
    const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    item.iconPath = STATUS_ICON[task.status] ?? STATUS_ICON.pending;
    item.tooltip = task.content;
    item.kind = "task";
    return item;
  }
}

function activate(context) {
  const provider = new TasksProvider();
  const view = vscode.window.createTreeView("claudeTasks.list", { treeDataProvider: provider });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "claudeTasks.focus";
  context.subscriptions.push(view, status);

  const render = () => {
    // Resync: drop the lists of sessions Claude Code no longer has open (closed tab, exited CLI).
    model.removeClosedSessions({ stateDir: config().stateDir });
    provider.reload();
    const focused = provider.focused;
    const text = model.statusBarText(focused);
    if (text) {
      status.text = text;
      status.tooltip = new vscode.MarkdownString(model.tooltipMarkdown(focused));
      status.show();
    } else {
      status.hide();
    }
    const unfinished = provider.sessions.filter((s) => !s.summary.finished).length;
    view.badge = unfinished > 0 ? { value: unfinished, tooltip: `${unfinished} active task list(s)` } : undefined;
  };

  let timer;
  const scheduleRender = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 150); // the hook writes tmp + rename; coalesce the events
  };

  let watcher;
  const watch = () => {
    watcher?.close();
    const dir = config().stateDir;
    try {
      fs.mkdirSync(dir, { recursive: true });
      watcher = fs.watch(dir, scheduleRender);
    } catch {
      watcher = undefined; // the 30 s tick below still refreshes
    }
  };
  watch();

  // Closing a Claude tab may write nothing we watch, so poll the session registry too.
  // Also keeps "3m ago" honest and covers a dead watcher.
  const tick = setInterval(render, 10_000);
  context.subscriptions.push(
    { dispose: () => { clearInterval(tick); clearTimeout(timer); watcher?.close(); } },
    vscode.window.tabGroups.onDidChangeTabs(scheduleRender),
    vscode.window.tabGroups.onDidChangeTabGroups(scheduleRender),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("claudeTasks")) return;
      watch();
      render();
    }),
    vscode.commands.registerCommand("claudeTasks.refresh", render),
    vscode.commands.registerCommand("claudeTasks.focus", () =>
      vscode.commands.executeCommand("claudeTasks.list.focus"),
    ),
    vscode.commands.registerCommand("claudeTasks.toggleWorkspaceFilter", async () => {
      const c = vscode.workspace.getConfiguration("claudeTasks");
      await c.update("currentWorkspaceOnly", !c.get("currentWorkspaceOnly", true), vscode.ConfigurationTarget.Global);
    }),
  );
  render();
}

function deactivate() {}

module.exports = { activate, deactivate };

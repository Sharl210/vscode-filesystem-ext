import type * as vscode from 'vscode';
import { registerGatewayCommands } from './commands';

let disposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  disposables = registerGatewayCommands(context);
  context.subscriptions.push(...disposables);
}

export async function deactivate(): Promise<void> {
  for (const disposable of disposables) {
    disposable.dispose();
  }

  disposables = [];
}

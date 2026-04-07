const assert = require('node:assert/strict');
const vscode = require('vscode');

describe('workspace web gateway extension host smoke', () => {
  it('starts the real extension service and returns accessible roots', async () => {
    await vscode.commands.executeCommand('workspaceWebGateway.copyAccessUrl');

    const copiedUrl = await retry(async () => {
      const value = await vscode.env.clipboard.readText();
      if (!value.includes('127.0.0.1')) {
        throw new Error('Gateway URL has not reached the clipboard yet.');
      }
      return value;
    });

    const rootResponse = await fetch(copiedUrl, { redirect: 'manual' });
    const redirectLocation = rootResponse.headers.get('location');
    const token = redirectLocation ? new URL(redirectLocation, copiedUrl).searchParams.get('token') : null;

    assert.ok(token, 'Expected a tokenized gateway URL.');

    const parsed = new URL(copiedUrl);
    const cookieHeader = `workspace-web-gateway-token=${token}`;

    const response = await fetch(`${parsed.origin}/api/workspaces`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    assert.equal(response.status, 200, 'Expected /api/workspaces to succeed.');

    const payload = await response.json();
    assert.equal(payload.ok, true, 'Expected JSON envelope with ok=true.');
    assert.ok(Array.isArray(payload.data.items), 'Expected root list array.');
    assert.ok(payload.data.items.length >= 1, 'Expected at least one root.');
    assert.ok(
      payload.data.items.some((item) => item.source === 'workspace' && item.name.includes('workspace-smoke')),
      'Expected the opened fixture workspace to appear in the workspace roots.'
    );

    const html = await fetch(parsed.origin, {
      headers: {
        Cookie: cookieHeader
      }
    }).then((value) => value.text());
    assert.ok(html.includes('data-testid="roots-tree"'), 'Expected explorer tree skeleton in real HTML.');
    assert.ok(html.includes('data-testid="file-list"'), 'Expected file list skeleton in real HTML.');
    assert.ok(html.includes('data-testid="editor-tabs"'), 'Expected tab strip skeleton in real HTML.');

    const workspaceRoot = payload.data.items.find((item) => item.source === 'workspace');
    assert.ok(workspaceRoot, 'Expected a workspace root in the returned roots.');

    const treeResponse = await fetch(
      `${parsed.origin}/api/tree?workspace=${encodeURIComponent(workspaceRoot.id)}&path=`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    assert.equal(treeResponse.status, 200, 'Expected /api/tree to succeed for the real workspace.');
    const treePayload = await treeResponse.json();
    assert.ok(treePayload.data.items.some((item) => item.name === 'sample.txt'), 'Expected sample.txt in real tree response.');

    const fileResponse = await fetch(
      `${parsed.origin}/api/file?workspace=${encodeURIComponent(workspaceRoot.id)}&path=sample.txt`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    assert.equal(fileResponse.status, 200, 'Expected /api/file to succeed for the real workspace file.');
    const filePayload = await fileResponse.json();
    assert.equal(filePayload.data.content.trim(), 'hello from fixture');

    const sandboxPrefix = `qa-${Date.now()}`;

    await postJson(`${parsed.origin}/api/mkdir`, token, {
      workspace: workspaceRoot.id,
      path: sandboxPrefix
    });

    await postJson(`${parsed.origin}/api/new-file`, token, {
      workspace: workspaceRoot.id,
      path: `${sandboxPrefix}/created.txt`
    });

    await putJson(`${parsed.origin}/api/file?workspace=${encodeURIComponent(workspaceRoot.id)}&path=${encodeURIComponent(`${sandboxPrefix}/created.txt`)}`, token, {
      content: 'created through extension host',
      encoding: 'utf-8'
    });

    await postJson(`${parsed.origin}/api/rename`, token, {
      workspace: workspaceRoot.id,
      fromPath: `${sandboxPrefix}/created.txt`,
      toPath: `${sandboxPrefix}/renamed.txt`
    });

    await postJson(`${parsed.origin}/api/upload`, token, createUploadForm(workspaceRoot.id, sandboxPrefix, 'upload.txt', 'upload body'));

    await postJson(`${parsed.origin}/api/copy`, token, {
      fromWorkspace: workspaceRoot.id,
      fromPath: `${sandboxPrefix}/renamed.txt`,
      toWorkspace: workspaceRoot.id,
      toPath: `${sandboxPrefix}/copied.txt`
    });

    await postJson(`${parsed.origin}/api/move`, token, {
      fromWorkspace: workspaceRoot.id,
      fromPath: `${sandboxPrefix}/copied.txt`,
      toWorkspace: workspaceRoot.id,
      toPath: `${sandboxPrefix}/moved.txt`
    });

    const downloadResponse = await fetch(
      `${parsed.origin}/api/download?workspace=${encodeURIComponent(workspaceRoot.id)}&path=${encodeURIComponent(`${sandboxPrefix}/moved.txt`)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    assert.equal(downloadResponse.status, 200, 'Expected /api/download to succeed for moved file.');
    assert.equal(await downloadResponse.text(), 'created through extension host');

    const archiveResponse = await fetch(
      `${parsed.origin}/api/export/archive?workspace=${encodeURIComponent(workspaceRoot.id)}&path=${encodeURIComponent('sample.txt')}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    assert.equal(archiveResponse.status, 200, 'Expected /api/export/archive to succeed for real workspace file.');
    assert.match(archiveResponse.headers.get('content-type') ?? '', /application\/x-tar/);
    assert.match(archiveResponse.headers.get('content-disposition') ?? '', /sample\.tar/);
    const archiveBytes = new Uint8Array(await archiveResponse.arrayBuffer());
    const archiveText = new TextDecoder('latin1').decode(archiveBytes);
    assert.ok(archiveText.includes('sample.txt'), 'Expected exported tar to contain sample.txt entry name.');
    assert.ok(archiveText.includes('hello from fixture'), 'Expected exported tar to contain sample file content.');

    const disguiseResponse = await fetch(
      `${parsed.origin}/api/export/disguised-image?workspace=${encodeURIComponent(workspaceRoot.id)}&path=${encodeURIComponent('sample.txt')}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    assert.equal(disguiseResponse.status, 200, 'Expected /api/export/disguised-image to succeed for real workspace file.');
    assert.match(disguiseResponse.headers.get('content-type') ?? '', /image\/png/);
    assert.match(disguiseResponse.headers.get('content-disposition') ?? '', /sample\.png/);
    const disguisedBytes = new Uint8Array(await disguiseResponse.arrayBuffer());
    assert.deepEqual(Array.from(disguisedBytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], 'Expected disguised export to start with PNG signature.');
    const disguisedArchiveText = new TextDecoder('latin1').decode(disguisedBytes);
    assert.ok(disguisedArchiveText.includes('sample.txt'), 'Expected disguised image archive to preserve sample.txt entry name.');
    assert.ok(disguisedArchiveText.includes('hello from fixture'), 'Expected disguised image archive to preserve sample file content.');

    const sandboxTree = await fetch(
      `${parsed.origin}/api/tree?workspace=${encodeURIComponent(workspaceRoot.id)}&path=${encodeURIComponent(sandboxPrefix)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    ).then((value) => value.json());

    const sandboxNames = sandboxTree.data.items.map((item) => item.name).sort();
    assert.deepEqual(sandboxNames, ['moved.txt', 'renamed.txt', 'upload.txt']);

    const deleteResponse = await fetch(
      `${parsed.origin}/api/file?workspace=${encodeURIComponent(workspaceRoot.id)}&path=${encodeURIComponent(sandboxPrefix)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    assert.equal(deleteResponse.status, 200, 'Expected deleting the sandbox directory to succeed.');

    const rootAfterDelete = await fetch(
      `${parsed.origin}/api/tree?workspace=${encodeURIComponent(workspaceRoot.id)}&path=`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    ).then((value) => value.json());

    assert.ok(
      !rootAfterDelete.data.items.some((item) => item.name === sandboxPrefix),
      'Expected the sandbox directory to be removed from the root listing.'
    );

    if (process.env.KEEP_SERVICE_ALIVE === '1') {
      await import('node:fs/promises').then((fs) =>
        fs.writeFile('/tmp/vscode-filesystem-ext-live-url.txt', copiedUrl, 'utf8')
      );
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }

    await vscode.commands.executeCommand('workspaceWebGateway.stopService');
  });
});

async function postJson(url, token, payload) {
  const headers = {
    Authorization: `Bearer ${token}`
  };

  if (!(payload instanceof FormData)) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: payload instanceof FormData ? payload : JSON.stringify(payload)
  });

  assert.ok(response.ok, `Expected POST ${url} to succeed.`);
  return response;
}

async function putJson(url, token, payload) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  assert.ok(response.ok, `Expected PUT ${url} to succeed.`);
  return response;
}

function createUploadForm(workspaceId, path, fileName, content) {
  const form = new FormData();
  form.set('workspace', workspaceId);
  form.set('path', path);
  form.set('file', new Blob([content], { type: 'text/plain' }), fileName);
  return form;
}

async function retry(action, attempts = 20, delayMs = 250) {
  let lastError;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

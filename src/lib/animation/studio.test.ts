import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Skeleton } from '../../../vendor/rigby/src/core/model.js';
import { Pose } from '../../../vendor/rigby/src/core/pose.js';
import { ScenePlayer } from '../../../vendor/rigby/src/core/scene.js';
import * as archive from '../../../vendor/rigby/src/editor/zip.js';
import { authoringOptions, artworkFiles } from '../../../vendor/rigby/src/editor/nucleas-authoring.js';
import { planBrowserRender } from '../../../vendor/rigby/src/editor/nucleas-render-plan.js';
import { SCENE_DEFAULTS, checkLocalProject, validateSceneRequest } from '../../../vendor/scene-kit/contract.mjs';
import { buildScene } from '../../../vendor/scene-kit/build.mjs';
import { memoryFiles, clearFiles } from '../../../vendor/scene-kit/memory-files.mjs';
import library from '../../../vendor/scene-kit/library-files.json';
import { editorForAsset } from '../creative/editors';
import { inspectRigby } from './rigbyProject';

describe('animation studio authoring and render contracts', () => {
  const options = { kind: 'animation', name: 'Product launch', width: 960, height: 540, fps: 24, duration: 3 };
  it('reopens source assets only within their own company context', () => {
    const asset = { id: 'version1', url: '/api/os/animation-projects?companyId=company1&id=version1' };
    expect(editorForAsset(asset, 'company1')?.payload).toMatchObject({ assetId: 'version1', tool: 'editor' });
    expect(editorForAsset(asset, 'company2')).toBeNull();
    expect(editorForAsset({ ...asset, url: 'https://other.example/source.gif' }, 'company1')).toBeNull();
  });
  it('allows arbitrary named artwork and scenes without a game action', () => {
    expect(authoringOptions(options).name).toBe('Product launch');
    expect(authoringOptions({ ...options, kind: 'scene', name: 'Logo reveal' }).kind).toBe('scene');
    expect(() => authoringOptions({ ...options, width: Infinity })).toThrow();
    expect(() => authoringOptions({ ...options, duration: 0 })).toThrow();
  });
  it('bounds decoded artwork before allocation', () => {
    const png = new Uint8Array(readFileSync('vendor/scene-kit/library/contact.png'));
    expect(artworkFiles([{ name: 'my-logo.png', bytes: png.buffer }])).toHaveLength(1);
    new DataView(png.buffer).setUint32(16, 0xffffffff);
    expect(() => artworkFiles([{ name: 'oversized.png', bytes: png.buffer }])).toThrow(/8192/);
    expect(() => artworkFiles([{ name: 'text.png', bytes: new ArrayBuffer(32) }])).toThrow(/PNG/);
  });
  const project = () => Skeleton.fromJson(new TextDecoder().decode(archive.unzip(readFileSync('public/office/rigs/design.rigby')).get('project.json')));
  it('preserves native animation, transparency, FPS and inclusive frame ranges', () => {
    const [job] = planBrowserRender(project(), { out: 'walk.gif', animation: ['walk'], width: 240, height: 240, fps: 20, background: 'none', start: 2, end: 10 });
    expect(job.animationName).toBe('walk');
    expect(job.settings).toMatchObject({ width: 240, height: 240, fps: 20, background: null });
    expect(job).toMatchObject({ format: 'gif', start: 2, end: 10 });
  });
  it('supports all clips, video quality and alpha color', () => {
    const jobs = planBrowserRender(project(), { out: 'clips.webm', all: true, width: 128, height: 128, fps: 10, background: '#11223380', quality: 'medium' });
    expect(jobs).toHaveLength(9);
    expect(new Set(jobs.map(j => j.name)).size).toBe(9);
    expect(jobs[0].quality).toBe('medium');
    expect(jobs[0].settings.background[3]).toBeCloseTo(128 / 255);
  });
  it('preserves a fixed or animated camera view when resizing without changing source settings', () => {
    const source = project();
    const doc = { ...source, settings: { ...source.settings, width: 1280, height: 720, frame: { x: 640, y: 360, scale: 1, camera: true } } };
    const opts = { out: 'walk.gif', animation: ['walk'], width: 480, height: 270, fps: 20 };
    const [small] = planBrowserRender(doc, opts);
    expect(small.settings.frame).toMatchObject({ x: 640, y: 360, camera: true });
    expect(small.settings.frame.scale * 480).toBeCloseTo(1280);
    expect(small.settings.frame.scale * 270).toBeCloseTo(720);
    const [square] = planBrowserRender(doc, { ...opts, height: 480 });
    expect(square.settings.frame.scale * 480).toBeGreaterThanOrEqual(720);
    expect(doc.settings.frame.scale).toBe(1);
    expect(planBrowserRender(doc, { ...opts, preserveFraming: false })[0].settings.frame.scale).toBe(1);
  });
  it('rejects impossible frame ranges, unsafe filenames and excessive memory', () => {
    for (const patch of [{ start: 100000 }, { end: -1 }, { start: 10, end: 2 }, { width: 4096, height: 4096 }, { fps: 120 }, { out: '../video.gif' }]) {
      expect(() => planBrowserRender(project(), { out: 'walk.gif', animation: ['walk'], width: 240, height: 240, fps: 20, ...patch })).toThrow();
    }
  });
  it('bounds archive paths and expanded size before unpacking', () => {
    expect(() => checkLocalProject(archive.zip([{ path: '../project.json', bytes: new Uint8Array([1]) }]))).toThrow(/path/);
    const bytes = archive.zip([{ path: 'project.json', bytes: new Uint8Array([1]) }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(view.getUint32(bytes.length - 6, true) + 24, 256 * 1024 * 1024, true);
    expect(() => checkLocalProject(bytes)).toThrow(/96 MB/);
  });
});

describe('Hyperdisc compiler in the browser worker filesystem', () => {
  const rigby = { Skeleton, Pose, ScenePlayer, ...archive };
  beforeEach(() => {
    clearFiles();
    for (const file of library) memoryFiles.writeFileSync('/' + file, readFileSync('vendor/scene-kit/library/' + file));
  });
  it.each(['tiffany', 'mick'])('builds real %s stair motion and an editable archive', actor => {
    const result = buildScene({ ...SCENE_DEFAULTS, actor }, rigby, null);
    if (!('report' in result)) throw Error('Expected a compiled scene report.');
    checkLocalProject(result.bytes);
    expect(inspectRigby(result.bytes, 64 * 1024 * 1024).animations.length).toBeGreaterThan(0);
    const doc = Skeleton.fromJson(new TextDecoder().decode(archive.unzip(result.bytes).get('project.json')));
    expect(doc.validate()).toBeNull();
    expect(result.report.duration).toBeGreaterThan(0);
    expect(doc.animations.length).toBeGreaterThan(0);
  });
  it.each(['disc-pass', 'jump-catch'])('keeps %s prop attachments within a tenth of a pixel', sequence => {
    const result = buildScene({ ...SCENE_DEFAULTS, mode: 'sequence', sequence, pace: 1.1, arcHeight: 80 }, rigby, null);
    if (!('report' in result) || !('maximumAttachmentError' in result.report) || !('phases' in result.report)) throw Error('Expected a compiled sequence report.');
    expect(result.report.maximumAttachmentError).toBeLessThan(.1);
    expect(inspectRigby(result.bytes, 64 * 1024 * 1024).bytes).toBe(result.bytes.length);
    const scene = Skeleton.fromJson(new TextDecoder().decode(archive.unzip(result.bytes).get('project.json')));
    expect(scene.scene?.actors).toHaveLength(2);
    expect(result.report.phases[0].catch).toBeGreaterThan(result.report.phases[0].release);
    expect(archive.unzip(result.bytes).has('project.json')).toBe(true);
  });
  it('round-trips editable contact rigs and keeps uploaded contact data bounded', () => {
    const contact = buildScene(SCENE_DEFAULTS, rigby, null, true);
    const result = buildScene(SCENE_DEFAULTS, rigby, contact.bytes);
    if (!('report' in result)) throw Error('Expected a compiled scene report.');
    expect(result.report.duration).toBeGreaterThan(0);
    expect(() => buildScene(SCENE_DEFAULTS, rigby, new Uint8Array(13 * 1024 * 1024))).toThrow(/12 MB/);
  });
  it('rejects invalid library references and non-finite motion parameters', () => {
    expect(() => validateSceneRequest({ ...SCENE_DEFAULTS, actor: '../secret' })).toThrow(/character/);
    expect(() => validateSceneRequest({ ...SCENE_DEFAULTS, scale: NaN })).toThrow(/scale/);
  });
});

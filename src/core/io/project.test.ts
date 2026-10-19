import { describe, expect, it } from 'vitest';
import { randomGrid } from '../test-utils.ts';
import { parseProject, serializeProject, type Project } from './project.ts';

const project: Project = {
  title: 'Cat',
  settings: {
    crop: { x: 1.5, y: 0, width: 100.25, height: 50 },
    square: false,
    width: 20,
    cutoff: null,
    invert: true,
    brightness: -10,
    contrast: 30,
  },
  grid: randomGrid(20, 10, 3),
  edits: new Map([
    [0, 1],
    [199, 0],
  ]),
  fixed: new Set([199]),
  image: 'data:image/jpeg;base64,AAAA',
};
const saved = () => JSON.parse(serializeProject(project));
const parse = (data: unknown) => () => parseProject(JSON.stringify(data));

describe('project files', () => {
  it('round-trips every field', () => {
    expect(parseProject(serializeProject(project))).toEqual(project);
    const noImage = { ...project, image: undefined };
    expect(parseProject(serializeProject(noImage))).toEqual(noImage);
  });

  it('writes the difficulty when given, and ignores it when reading', () => {
    expect(saved().difficulty).toBeUndefined();
    const rated = serializeProject({ ...project, difficulty: 'Hard' });
    expect(JSON.parse(rated).difficulty).toBe('Hard');
    expect(parseProject(rated)).toEqual(project);
  });

  it('writes the grid as readable rows', () => {
    expect(saved().grid).toHaveLength(10);
    expect(saved().grid[0]).toMatch(/^[01]{20}$/);
  });

  it('names an unknown version', () => {
    expect(parse({ ...saved(), version: 2 })).toThrow(
      'This project is version 2; this app opens version 1.',
    );
  });

  it.each([
    ['JSON', () => parseProject('{not json')],
    ['version', parse([1, 2])],
    ['version', parse({ ...saved(), version: '1' })],
    ['title', parse({ ...saved(), title: undefined })],
    ['settings', parse({ ...saved(), settings: null })],
    [
      'settings.crop',
      parse({
        ...saved(),
        settings: {
          ...saved().settings,
          crop: { x: 0, y: 0, width: 0, height: 5 },
        },
      }),
    ],
    [
      'settings.crop',
      parse({
        ...saved(),
        settings: {
          ...saved().settings,
          crop: { x: -1, y: 0, width: 5, height: 5 },
        },
      }),
    ],
    [
      'settings.width',
      parse({ ...saved(), settings: { ...saved().settings, width: 51 } }),
    ],
    [
      'settings.cutoff',
      parse({ ...saved(), settings: { ...saved().settings, cutoff: '128' } }),
    ],
    [
      'settings.invert',
      parse({ ...saved(), settings: { ...saved().settings, invert: 1 } }),
    ],
    [
      'settings.contrast',
      parse({ ...saved(), settings: { ...saved().settings, contrast: 101 } }),
    ],
    ['grid', parse({ ...saved(), grid: [...saved().grid.slice(1), '0'] })],
    ['grid', parse({ ...saved(), grid: saved().grid.slice(6) })],
    [
      'grid',
      parse({
        ...saved(),
        grid: saved().grid.map((r: string) => r.replace('0', '2')),
      }),
    ],
    ['edits', parse({ ...saved(), edits: [[200, 1]] })],
    ['edits', parse({ ...saved(), edits: [[0, 2]] })],
    ['fixed', parse({ ...saved(), fixed: [-1] })],
    ['image', parse({ ...saved(), image: 'https://example.com/cat.jpg' })],
  ])('rejects a bad %s', (field, load) => {
    expect(load).toThrow(
      `This isn't a valid project file (problem: ${field}).`,
    );
  });
});

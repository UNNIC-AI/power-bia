import { describe, expect, it } from 'vitest';
import { pointsElsewhere } from './source.js';

/**
 * The predicate that decides whether a boot discards the catalogue. Getting it
 * wrong either keeps a catalogue describing a model nobody is querying any more,
 * or throws away the curated one the seed wrote for the model in `PBI_*`.
 */
describe('pointsElsewhere', () => {
  const source = { workspaceName: 'Ventas', datasetName: 'Iowa Liquor' };

  it('is false for a row that was never pointed anywhere', () => {
    expect(pointsElsewhere({ workspaceName: '', datasetName: '' }, source)).toBe(false);
  });

  it('is false for a half-written row, which is not a model either', () => {
    expect(pointsElsewhere({ workspaceName: 'Ventas', datasetName: '' }, source)).toBe(false);
  });

  it('is false when the environment names the same model', () => {
    expect(pointsElsewhere({ ...source }, source)).toBe(false);
  });

  it('is true when the dataset within the same workspace changed', () => {
    expect(pointsElsewhere({ workspaceName: 'Ventas', datasetName: 'Otro' }, source)).toBe(true);
  });

  it('is true when the workspace changed', () => {
    expect(pointsElsewhere({ workspaceName: 'Pruebas', datasetName: 'Iowa Liquor' }, source)).toBe(
      true,
    );
  });

  // Power BI names are case sensitive in XMLA, so this is a different model.
  it('is true for a name that differs only in case', () => {
    expect(pointsElsewhere({ workspaceName: 'ventas', datasetName: 'Iowa Liquor' }, source)).toBe(
      true,
    );
  });
});

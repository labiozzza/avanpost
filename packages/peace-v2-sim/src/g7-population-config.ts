import populationBalance from '../../../content/peace-v2/g7.1-population.json';
import { PopulationBalanceSchema } from '@avanpost/peace-v2-shared';

export const G7_1_POPULATION_BALANCE = PopulationBalanceSchema.parse(populationBalance);

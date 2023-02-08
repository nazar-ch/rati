import { expectType, expectError } from 'tsd';
import { responseKey } from '../common/apiUtils';

const removeApiMock = async ({ x }: { x: string }) => ({
    a: '1',
    b: { k: 2 },
});

const removeApiArrayMock = async () => [1, 2, 3];

// Should have correct return type
expectType<Promise<string>>(responseKey(removeApiMock, 'a')({ x: '' }));
expectType<Promise<{ k: number }>>(responseKey(removeApiMock, 'b')({ x: '' }));

// Should error for non-existing key
expectError(responseKey(removeApiMock, 'a')({ x: '' }));

// Should error when the arguments are not provided
expectError(responseKey(removeApiMock, 'b')());

// Should error for non-object return type
expectError(responseKey(removeApiArrayMock, '' as any)());
